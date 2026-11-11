import { q, q1 } from "./db";
import { HttpError } from "./auth";

export type Site = {
  id: number;
  user_id: number;
  name: string;
  timezone: string;
  auto_snapshot: boolean;
  created_at: string;
};

export type MetricRow = {
  date: string; // YYYY-MM-DD (day) or YYYY-MM-01 (month)
  visitors: number | null;
  pageviews: number | null;
  bounce_rate: number | null;
};

export type MonthRow = MetricRow & { month: string; days: number; granularity: "day" | "month" };

export type SourceRow = {
  id: number;
  site_id: number;
  kind: string;
  label: string;
  active: boolean;
  last_success_at: string | null;
  last_error: string | null;
  created_at: string;
};

export type SnapshotRow = {
  id: number;
  kind: string;
  label: string;
  status: string;
  rows: number;
  range_from: string | null;
  range_to: string | null;
  visitors: number | null;
  error: string | null;
  created_at: string;
};

/* ---------------- sites ---------------- */

export async function listSites(userId: number): Promise<(Site & { sources: number; first_date: string | null })[]> {
  return q(
    `SELECT s.*,
       (SELECT COUNT(*)::int FROM sources WHERE site_id = s.id) AS sources,
       (SELECT MIN(date) FROM metrics WHERE site_id = s.id) AS first_date
     FROM sites s WHERE user_id = $1 ORDER BY s.id`,
    [userId]
  );
}

export async function getSite(userId: number, siteId: number): Promise<Site> {
  const s = await q1<Site>("SELECT * FROM sites WHERE id = $1 AND user_id = $2", [siteId, userId]);
  if (!s) throw new HttpError(404, "Site not found");
  return s;
}

export async function createSite(userId: number, name: string, timezone = "UTC"): Promise<number> {
  const r = await q1<{ id: number }>(
    "INSERT INTO sites (user_id, name, timezone) VALUES ($1, $2, $3) RETURNING id",
    [userId, name, timezone]
  );
  return r!.id;
}

export async function updateSite(siteId: number, p: { name?: string; timezone?: string; auto_snapshot?: boolean }) {
  await q(
    `UPDATE sites SET name = COALESCE($2, name), timezone = COALESCE($3, timezone),
       auto_snapshot = COALESCE($4, auto_snapshot) WHERE id = $1`,
    [siteId, p.name ?? null, p.timezone ?? null, p.auto_snapshot ?? null]
  );
}

export async function deleteSite(siteId: number) {
  await q("DELETE FROM sites WHERE id = $1", [siteId]);
}

/* ---------------- metrics ---------------- */

/** Bulk upsert in one statement per 1,000 rows, so imports don't make a round trip per row. */
export async function upsertMetrics(
  siteId: number,
  granularity: "day" | "month",
  rows: MetricRow[],
  origin: string
): Promise<number> {
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    await q(
      `INSERT INTO metrics (site_id, granularity, date, visitors, pageviews, bounce_rate, origin, updated_at)
       SELECT $1, $2, t.d, t.v, t.p, t.b, $3, now()
       FROM unnest($4::text[], $5::int[], $6::int[], $7::float8[]) AS t(d, v, p, b)
       ON CONFLICT (site_id, granularity, date) DO UPDATE SET
         visitors = COALESCE(EXCLUDED.visitors, metrics.visitors),
         pageviews = COALESCE(EXCLUDED.pageviews, metrics.pageviews),
         bounce_rate = COALESCE(EXCLUDED.bounce_rate, metrics.bounce_rate),
         origin = EXCLUDED.origin,
         updated_at = EXCLUDED.updated_at`,
      [
        siteId,
        granularity,
        origin,
        chunk.map((r) => r.date),
        chunk.map((r) => (r.visitors == null ? null : Math.round(r.visitors))),
        chunk.map((r) => (r.pageviews == null ? null : Math.round(r.pageviews))),
        chunk.map((r) => r.bounce_rate),
      ]
    );
  }
  return rows.length;
}

export async function dailyMetrics(siteId: number): Promise<MetricRow[]> {
  return q(
    "SELECT date, visitors, pageviews, bounce_rate FROM metrics WHERE site_id = $1 AND granularity = 'day' ORDER BY date",
    [siteId]
  );
}

/**
 * Monthly totals. Months with daily data are summed from days (sum of daily
 * visitors); months that only have an imported monthly total use that total.
 */
export async function monthlyMetrics(siteId: number): Promise<MonthRow[]> {
  const [days, months] = await Promise.all([
    q<{ month: string; visitors: number | null; pageviews: number | null; bounce_rate: number | null; days: number }>(
      `SELECT substr(date,1,7) AS month, SUM(visitors)::int AS visitors, SUM(pageviews)::int AS pageviews,
              AVG(bounce_rate)::float8 AS bounce_rate, COUNT(*)::int AS days
       FROM metrics WHERE site_id = $1 AND granularity = 'day' GROUP BY 1`,
      [siteId]
    ),
    q<{ month: string; visitors: number | null; pageviews: number | null; bounce_rate: number | null }>(
      `SELECT substr(date,1,7) AS month, visitors, pageviews, bounce_rate
       FROM metrics WHERE site_id = $1 AND granularity = 'month'`,
      [siteId]
    ),
  ]);

  const map = new Map<string, MonthRow>();
  for (const m of months) map.set(m.month, { ...m, date: m.month + "-01", days: 0, granularity: "month" });
  for (const d of days) {
    const existing = map.get(d.month);
    // Prefer a full imported monthly total over a partial set of days.
    if (existing && existing.visitors != null && d.days < daysInMonth(d.month)) {
      existing.days = d.days;
      continue;
    }
    map.set(d.month, { ...d, date: d.month + "-01", granularity: "day" });
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/* ---------------- sources & snapshots ---------------- */

export async function listSources(siteId: number): Promise<SourceRow[]> {
  return q(
    "SELECT id, site_id, kind, label, active, last_success_at, last_error, created_at FROM sources WHERE site_id = $1 ORDER BY id",
    [siteId]
  );
}

export async function getSourceForUser(userId: number, sourceId: number) {
  const s = await q1<SourceRow & { config_enc: string }>(
    "SELECT src.* FROM sources src JOIN sites s ON s.id = src.site_id WHERE src.id = $1 AND s.user_id = $2",
    [sourceId, userId]
  );
  if (!s) throw new HttpError(404, "Source not found");
  return s;
}

export async function listSnapshots(siteId: number, limit = 50): Promise<SnapshotRow[]> {
  return q(
    `SELECT id, kind, label, status, rows, range_from, range_to, visitors, error, created_at
     FROM snapshots WHERE site_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [siteId, limit]
  );
}

export async function recordSnapshot(p: {
  siteId: number;
  sourceId?: number | null;
  kind: string;
  label: string;
  status: "ok" | "error";
  rows?: number;
  rangeFrom?: string | null;
  rangeTo?: string | null;
  visitors?: number | null;
  error?: string | null;
  raw?: string | null;
}) {
  await q(
    `INSERT INTO snapshots (site_id, source_id, kind, label, status, rows, range_from, range_to, visitors, error, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      p.siteId,
      p.sourceId ?? null,
      p.kind,
      p.label,
      p.status,
      p.rows ?? 0,
      p.rangeFrom ?? null,
      p.rangeTo ?? null,
      p.visitors ?? null,
      p.error ?? null,
      p.raw ?? null,
    ]
  );
}

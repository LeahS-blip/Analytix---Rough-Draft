import { db, tx } from "./db";
import { HttpError } from "./auth";

export type Site = {
  id: number;
  user_id: number;
  name: string;
  timezone: string;
  auto_snapshot: number;
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
  active: number;
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

export function listSites(userId: number): (Site & { sources: number; first_date: string | null })[] {
  return db()
    .prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM sources WHERE site_id = s.id) AS sources,
        (SELECT MIN(date) FROM metrics WHERE site_id = s.id) AS first_date
       FROM sites s WHERE user_id = ? ORDER BY s.id`
    )
    .all(userId) as never;
}

export function getSite(userId: number, siteId: number): Site {
  const s = db().prepare("SELECT * FROM sites WHERE id = ? AND user_id = ?").get(siteId, userId) as Site | undefined;
  if (!s) throw new HttpError(404, "Site not found");
  return s;
}

export function createSite(userId: number, name: string, timezone = "UTC"): number {
  const r = db().prepare("INSERT INTO sites (user_id, name, timezone) VALUES (?, ?, ?)").run(userId, name, timezone);
  return Number(r.lastInsertRowid);
}

export function updateSite(siteId: number, p: { name?: string; timezone?: string; auto_snapshot?: boolean }) {
  const s = db().prepare("SELECT * FROM sites WHERE id = ?").get(siteId) as Site;
  db()
    .prepare("UPDATE sites SET name = ?, timezone = ?, auto_snapshot = ? WHERE id = ?")
    .run(
      p.name ?? s.name,
      p.timezone ?? s.timezone,
      p.auto_snapshot === undefined ? s.auto_snapshot : p.auto_snapshot ? 1 : 0,
      siteId
    );
}

export function deleteSite(siteId: number) {
  db().prepare("DELETE FROM sites WHERE id = ?").run(siteId);
}

/* ---------------- metrics ---------------- */

export function upsertMetrics(
  siteId: number,
  granularity: "day" | "month",
  rows: MetricRow[],
  origin: string
): number {
  const stmt = db().prepare(
    `INSERT INTO metrics (site_id, granularity, date, visitors, pageviews, bounce_rate, origin, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(site_id, granularity, date) DO UPDATE SET
       visitors = COALESCE(excluded.visitors, metrics.visitors),
       pageviews = COALESCE(excluded.pageviews, metrics.pageviews),
       bounce_rate = COALESCE(excluded.bounce_rate, metrics.bounce_rate),
       origin = excluded.origin,
       updated_at = excluded.updated_at`
  );
  return tx(() => {
    for (const r of rows) stmt.run(siteId, granularity, r.date, r.visitors, r.pageviews, r.bounce_rate, origin);
    return rows.length;
  });
}

export function dailyMetrics(siteId: number): MetricRow[] {
  return db()
    .prepare(
      "SELECT date, visitors, pageviews, bounce_rate FROM metrics WHERE site_id = ? AND granularity = 'day' ORDER BY date"
    )
    .all(siteId) as MetricRow[];
}

/**
 * Monthly totals. Months with daily data are summed from days (sum of daily
 * visitors); months that only have an imported monthly total use that total.
 */
export function monthlyMetrics(siteId: number): MonthRow[] {
  const days = db()
    .prepare(
      `SELECT substr(date,1,7) AS month, SUM(visitors) AS visitors, SUM(pageviews) AS pageviews,
              AVG(bounce_rate) AS bounce_rate, COUNT(*) AS days
       FROM metrics WHERE site_id = ? AND granularity = 'day' GROUP BY month`
    )
    .all(siteId) as { month: string; visitors: number | null; pageviews: number | null; bounce_rate: number | null; days: number }[];
  const months = db()
    .prepare(
      `SELECT substr(date,1,7) AS month, visitors, pageviews, bounce_rate
       FROM metrics WHERE site_id = ? AND granularity = 'month'`
    )
    .all(siteId) as { month: string; visitors: number | null; pageviews: number | null; bounce_rate: number | null }[];

  const map = new Map<string, MonthRow>();
  for (const m of months)
    map.set(m.month, { ...m, date: m.month + "-01", days: 0, granularity: "month" });
  for (const d of days) {
    const existing = map.get(d.month);
    // Prefer a full imported monthly total over a partial set of days.
    if (existing && existing.visitors != null) {
      const dim = daysInMonth(d.month);
      if (d.days < dim) {
        existing.days = d.days;
        continue;
      }
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

export function listSources(siteId: number): SourceRow[] {
  return db()
    .prepare(
      "SELECT id, site_id, kind, label, active, last_success_at, last_error, created_at FROM sources WHERE site_id = ? ORDER BY id"
    )
    .all(siteId) as SourceRow[];
}

export function getSourceForUser(userId: number, sourceId: number) {
  const s = db()
    .prepare(
      "SELECT src.* FROM sources src JOIN sites s ON s.id = src.site_id WHERE src.id = ? AND s.user_id = ?"
    )
    .get(sourceId, userId) as (SourceRow & { config_enc: string }) | undefined;
  if (!s) throw new HttpError(404, "Source not found");
  return s;
}

export function listSnapshots(siteId: number, limit = 50): SnapshotRow[] {
  return db()
    .prepare(
      `SELECT id, kind, label, status, rows, range_from, range_to, visitors, error, created_at
       FROM snapshots WHERE site_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(siteId, limit) as SnapshotRow[];
}

export function recordSnapshot(p: {
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
  db()
    .prepare(
      `INSERT INTO snapshots (site_id, source_id, kind, label, status, rows, range_from, range_to, visitors, error, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
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
      p.raw ?? null
    );
}

/** Days (YYYY-MM-DD) that have a stored daily row, within the last `n` days. */
export function coveredDays(siteId: number, n: number): Set<string> {
  const since = new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const rows = db()
    .prepare("SELECT date FROM metrics WHERE site_id = ? AND granularity = 'day' AND date >= ?")
    .all(siteId, since) as { date: string }[];
  return new Set(rows.map((r) => r.date));
}

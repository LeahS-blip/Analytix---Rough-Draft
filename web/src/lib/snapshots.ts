import { q, q1 } from "./db";
import { decrypt } from "./secret";
import { recordSnapshot, upsertMetrics } from "./data";
import { DIMENSIONS, fetchBreakdown, fetchRecentDays, VercelConfig, VercelError } from "./vercel";

const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

type SourceRecord = {
  id: number;
  site_id: number;
  kind: string;
  label: string;
  config_enc: string;
  last_success_at: string | null;
  max_days: number | null; // learned plan limit, e.g. 30 on Vercel Hobby
};

/**
 * Pull the latest data for one source and store it.
 * First run backfills as far back as the provider allows; later runs refetch
 * the last 35 days so late-arriving numbers are corrected.
 */
export async function runSource(sourceId: number): Promise<{ ok: boolean; rows: number; error?: string }> {
  const src = await q1<SourceRecord>("SELECT * FROM sources WHERE id = $1", [sourceId]);
  if (!src) return { ok: false, rows: 0, error: "Source not found" };
  if (src.kind !== "vercel") return { ok: false, rows: 0, error: `Unsupported source kind ${src.kind}` };

  const cfg = await decrypt<VercelConfig>(src.config_enc);
  const until = day(0);
  // How far back Vercel lets us read depends on the plan (Hobby: latest 31 days).
  // Once we've learned the limit we ask for exactly that, so each run is a single request.
  // Before then, ask for a lot; fetchRecentDays shrinks to whatever Vercel says is allowed.
  const limit = src.max_days ?? null;
  const windows = src.last_success_at
    ? [Math.min(35, limit ?? 35)]
    : limit
      ? [limit]
      : [730, 365, 90, 30];
  let lastErr: unknown = null;

  for (const w of windows) {
    try {
      const { points, raw, days } = await fetchRecentDays(cfg, w);
      const since = day(-days);
      const rows = points.map((p) => ({ date: p.date, visitors: p.visitors, pageviews: p.pageviews, bounce_rate: null }));
      // These three writes don't depend on each other, so do them at once.
      await Promise.all([
        rows.length ? upsertMetrics(src.site_id, "day", rows, `vercel:${src.id}`) : null,
        recordSnapshot({
          siteId: src.site_id,
          sourceId: src.id,
          kind: "vercel",
          label: src.label,
          status: "ok",
          rows: rows.length,
          rangeFrom: rows[0]?.date ?? since,
          rangeTo: rows.at(-1)?.date ?? until,
          visitors: rows.reduce((a, r) => a + (r.visitors ?? 0), 0),
          raw: JSON.stringify(raw),
        }),
        q(
          // remember the plan limit when Vercel made us shrink the range
          "UPDATE sources SET last_success_at = now(), last_error = NULL, max_days = CASE WHEN $2::int < $3::int THEN $2::int ELSE max_days END WHERE id = $1",
          [src.id, days, w]
        ),
      ]);
      // The details (pages, referrers, countries, devices) are a bonus: never fail the snapshot over them.
      await collectBreakdowns(src.site_id, cfg, days, points).catch((e) => console.error("[keepstat] breakdowns failed", e));
      return { ok: true, rows: rows.length };
    } catch (e) {
      lastErr = e;
      // Auth / not-found errors won't improve with a shorter window.
      if (e instanceof VercelError && [401, 403, 404].includes(e.status)) break;
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  await q("UPDATE sources SET last_error = $1 WHERE id = $2", [msg, src.id]);
  await recordSnapshot({ siteId: src.site_id, sourceId: src.id, kind: "vercel", label: src.label, status: "error", error: msg });
  return { ok: false, rows: 0, error: msg };
}

const nextDay = (d: string) => new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10);

/**
 * Keep what made up the traffic. Vercel only shows its window; we keep every day.
 * First time: one row set for the whole allowed window. After that: one set per finished
 * day (yesterday, plus up to 6 missed days if a run was skipped), 4 small requests per day.
 */
export async function collectBreakdowns(
  siteId: number,
  cfg: VercelConfig,
  windowDays: number,
  points: { date: string; visitors: number }[] = []
) {
  const yesterday = day(-1);
  const oldestAllowed = day(-Math.max(1, windowDays - 1));
  const last = await q1<{ d: string | null }>("SELECT MAX(date_to) AS d FROM breakdowns WHERE site_id = $1", [siteId]);
  const ranges: [string, string][] = [];
  if (!last?.d) {
    if (oldestAllowed <= yesterday) ranges.push([oldestAllowed, yesterday]);
  } else {
    let d = nextDay(last.d);
    if (d < oldestAllowed) d = oldestAllowed; // Vercel no longer has anything older
    while (d <= yesterday && ranges.length < 7) {
      ranges.push([d, d]);
      d = nextDay(d);
    }
  }
  for (const [from, to] of ranges) {
    const results = await Promise.all(
      DIMENSIONS.map(async (dim) => ({ dim, rows: await fetchBreakdown(cfg, dim, from, to, from === to ? 15 : 50) }))
    );
    const flat = results.flatMap(({ dim, rows }) => rows.map((r) => ({ dim, ...r })));
    if (!flat.length) continue;
    await q(
      `INSERT INTO breakdowns (site_id, dimension, date_from, date_to, key, visitors, pageviews)
       SELECT $1, t.dim, $2, $3, t.k, t.v, t.p FROM unnest($4::text[], $5::text[], $6::int[], $7::int[]) AS t(dim, k, v, p)
       ON CONFLICT (site_id, dimension, date_from, date_to, key) DO UPDATE SET visitors = EXCLUDED.visitors, pageviews = EXCLUDED.pageviews`,
      [siteId, from, to, flat.map((r) => r.dim), flat.map((r) => r.key.slice(0, 300)), flat.map((r) => Math.round(r.visitors)), flat.map((r) => Math.round(r.pageviews))]
    );
  }

  // Spike days still inside the window: ask who sent that day's traffic, so the dashboard can
  // explain the spike even though the first backfill only stored one combined breakdown.
  // Stored as "spikeReferrer" so it never double-counts the referrer totals. At most 3 requests.
  const spikes = findSpikes(points).filter((d) => d >= oldestAllowed && d <= yesterday).slice(-3);
  if (!spikes.length) return;
  const known = await q<{ d: string }>(
    `SELECT DISTINCT date_from AS d FROM breakdowns WHERE site_id = $1 AND date_from = date_to
       AND dimension IN ('referrerHostname', 'spikeReferrer') AND date_from = ANY($2::text[])`,
    [siteId, spikes]
  );
  for (const d of spikes.filter((x) => !known.some((k) => k.d === x))) {
    const rows = await fetchBreakdown(cfg, "referrerHostname", d, d, 10);
    if (!rows.length) continue;
    await q(
      `INSERT INTO breakdowns (site_id, dimension, date_from, date_to, key, visitors, pageviews)
       SELECT $1, 'spikeReferrer', $2, $2, t.k, t.v, t.p FROM unnest($3::text[], $4::int[], $5::int[]) AS t(k, v, p)
       ON CONFLICT (site_id, dimension, date_from, date_to, key) DO UPDATE SET visitors = EXCLUDED.visitors, pageviews = EXCLUDED.pageviews`,
      [siteId, d, rows.map((r) => r.key.slice(0, 300)), rows.map((r) => Math.round(r.visitors)), rows.map((r) => Math.round(r.pageviews))]
    );
  }
}

/** Days well above normal: at least 2x the median of up to 28 days before (needs 7), and 10+ visitors. */
export function findSpikes(points: { date: string; visitors: number }[]): string[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const out: string[] = [];
  sorted.forEach((p, i) => {
    const before = sorted.slice(Math.max(0, i - 28), i).map((x) => x.visitors).sort((a, b) => a - b);
    if (before.length < 7) return;
    const m = before.length % 2 ? before[(before.length - 1) / 2] : (before[before.length / 2 - 1] + before[before.length / 2]) / 2;
    if (p.visitors >= 10 && m > 0 && p.visitors >= 2 * m) out.push(p.date);
  });
  return out;
}

/** Run every active source whose site has auto-snapshots on and that hasn't succeeded in ~20h. */
export async function runDueSources(): Promise<{ ran: number; failed: number }> {
  const due = await q<{ id: number }>(
    `SELECT src.id FROM sources src JOIN sites s ON s.id = src.site_id
     WHERE src.active AND s.auto_snapshot
       AND (src.last_success_at IS NULL OR src.last_success_at < now() - interval '20 hours')
       AND NOT EXISTS (SELECT 1 FROM snapshots sn WHERE sn.source_id = src.id AND sn.status = 'error'
                       AND sn.created_at > now() - interval '1 hour')`
  );
  let failed = 0;
  for (const { id } of due) {
    const r = await runSource(id);
    if (!r.ok) failed++;
  }
  return { ran: due.length, failed };
}

import { q, q1 } from "./db";
import { decrypt } from "./secret";
import { recordSnapshot, upsertMetrics } from "./data";
import { fetchRecentDaysWith } from "./vercel";
import { provider } from "./providers";
import { DIMENSIONS, ProviderError, type Provider } from "./providers/types";

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
 * the last few weeks so late-arriving numbers are corrected.
 */
export async function runSource(sourceId: number): Promise<{ ok: boolean; rows: number; error?: string }> {
  const src = await q1<SourceRecord>("SELECT * FROM sources WHERE id = $1", [sourceId]);
  if (!src) return { ok: false, rows: 0, error: "Source not found" };
  if (src.kind === "push") return { ok: false, rows: 0, error: "This source receives data from your own script, so there's nothing to fetch." };

  let p: Provider<unknown>;
  try {
    p = provider(src.kind);
  } catch (e) {
    return { ok: false, rows: 0, error: (e as Error).message };
  }
  const cfg = await decrypt<unknown>(src.config_enc);
  const until = day(0);
  // How far back we may read depends on the provider/plan (Vercel Hobby: latest 31 days).
  // Once we've learned the limit we ask for exactly that, so each run is a single request.
  const limit = src.max_days ?? null;
  const windows = src.last_success_at ? [Math.min(p.refetch, limit ?? p.refetch)] : limit ? [limit] : p.backfill;
  let lastErr: unknown = null;

  for (const w of windows) {
    try {
      const { points, raw, days } = await fetchRecentDaysWith(p, cfg, w);
      const since = day(-days);
      const rows = points.map((x) => ({ date: x.date, visitors: x.visitors, pageviews: x.pageviews, bounce_rate: x.bounce_rate ?? null }));
      await Promise.all([
        rows.length ? upsertMetrics(src.site_id, "day", rows, `${src.kind}:${src.id}`) : null,
        recordSnapshot({
          siteId: src.site_id,
          sourceId: src.id,
          kind: src.kind,
          label: src.label,
          status: "ok",
          rows: rows.length,
          rangeFrom: rows[0]?.date ?? since,
          rangeTo: rows.at(-1)?.date ?? until,
          visitors: rows.reduce((a, r) => a + (r.visitors ?? 0), 0),
          raw: JSON.stringify(raw).slice(0, 200_000),
        }),
        q(
          // remember the plan limit when the provider made us shrink the range (or its fixed window)
          `UPDATE sources SET last_success_at = now(), last_error = NULL,
             max_days = CASE WHEN $2::int < $3::int THEN $2::int ELSE COALESCE(max_days, $4::int) END WHERE id = $1`,
          [src.id, days, w, p.shownDays ?? null]
        ),
      ]);
      // The details (pages, referrers, countries, devices) are a bonus: never fail the snapshot over them.
      if (p.fetchBreakdown && p.breakdowns !== "none" && (await collectsBreakdowns(src))) {
        await collectBreakdowns(src.site_id, p, cfg, days, points).catch((e) => console.error("[keepstat] breakdowns failed", e));
      }
      return { ok: true, rows: rows.length };
    } catch (e) {
      lastErr = e;
      // Auth / not-found errors won't improve with a shorter window.
      if (e instanceof ProviderError && [401, 403, 404].includes(e.status)) break;
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  await q("UPDATE sources SET last_error = $1 WHERE id = $2", [msg, src.id]);
  await recordSnapshot({ siteId: src.site_id, sourceId: src.id, kind: src.kind, label: src.label, status: "error", error: msg });
  return { ok: false, rows: 0, error: msg };
}

/** With several sources on one site, only the first connected one stores breakdowns, so nothing is counted twice. */
async function collectsBreakdowns(src: SourceRecord) {
  const first = await q1<{ id: number }>(
    "SELECT MIN(id)::int AS id FROM sources WHERE site_id = $1 AND active AND kind <> 'push'",
    [src.site_id]
  );
  return !first?.id || first.id === src.id;
}

const nextDay = (d: string) => new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10);

async function storeRows(siteId: number, from: string, to: string, flat: { dim: string; key: string; visitors: number; pageviews: number }[]) {
  if (!flat.length) return;
  await q(
    `INSERT INTO breakdowns (site_id, dimension, date_from, date_to, key, visitors, pageviews)
     SELECT $1, t.dim, $2, $3, t.k, t.v, t.p FROM unnest($4::text[], $5::text[], $6::int[], $7::int[]) AS t(dim, k, v, p)
     ON CONFLICT (site_id, dimension, date_from, date_to, key) DO UPDATE SET visitors = EXCLUDED.visitors, pageviews = EXCLUDED.pageviews`,
    [siteId, from, to, flat.map((r) => r.dim), flat.map((r) => r.key.slice(0, 300)), flat.map((r) => Math.round(r.visitors)), flat.map((r) => Math.round(r.pageviews))]
  );
}

/**
 * Keep what made up the traffic. Providers only show their window; we keep every day.
 * "range" providers: first time one row set for the whole allowed window, then one set per
 * finished day (up to 7 missed days). "window" providers (GitHub's fixed 14 days): one block
 * per window, never overlapping, so totals add up.
 */
export async function collectBreakdowns(
  siteId: number,
  p: Provider<unknown>,
  cfg: unknown,
  windowDays: number,
  points: { date: string; visitors: number }[] = []
) {
  const yesterday = day(-1);
  const last = await q1<{ d: string | null }>(
    "SELECT MAX(date_to) AS d FROM breakdowns WHERE site_id = $1 AND dimension <> 'spikeReferrer'",
    [siteId]
  );
  const fetchAll = async (from: string, to: string, limit: number) => {
    const results = await Promise.all(DIMENSIONS.map(async (dim) => ({ dim, rows: await p.fetchBreakdown!(cfg, dim, from, to, limit) })));
    return results.flatMap(({ dim, rows }) => rows.map((r) => ({ dim, ...r })));
  };

  if (p.breakdowns === "window") {
    const w = p.windowDays ?? 14;
    const from = day(-w);
    if (last?.d && last.d >= from) return; // the current window overlaps what we stored
    await storeRows(siteId, from, yesterday, await fetchAll(from, yesterday, 25));
    return;
  }

  const oldestAllowed = day(-Math.max(1, windowDays - 1));
  const ranges: [string, string][] = [];
  if (!last?.d) {
    // Split at the 30- and 60-day marks, so "last 30 days" and "the 30 before" work from day one.
    // At most three blocks (12 small requests), however long the history.
    let from = oldestAllowed;
    for (const cut of [day(-61), day(-31)]) {
      if (from <= cut && cut < yesterday) {
        ranges.push([from, cut]);
        from = nextDay(cut);
      }
    }
    if (from <= yesterday) ranges.push([from, yesterday]);
  } else {
    let d = nextDay(last.d);
    if (d < oldestAllowed) d = oldestAllowed; // the provider no longer has anything older
    while (d <= yesterday && ranges.length < 7) {
      ranges.push([d, d]);
      d = nextDay(d);
    }
  }
  for (const [from, to] of ranges) await storeRows(siteId, from, to, await fetchAll(from, to, from === to ? 15 : 50));

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
    const rows = await p.fetchBreakdown!(cfg, "referrerHostname", d, d, 10);
    await storeRows(siteId, d, d, rows.map((r) => ({ dim: "spikeReferrer", ...r })));
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
     WHERE src.active AND s.auto_snapshot AND src.kind <> 'push'
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

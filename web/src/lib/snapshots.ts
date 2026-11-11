import { q, q1 } from "./db";
import { decrypt } from "./secret";
import { recordSnapshot, upsertMetrics } from "./data";
import { fetchDaily, VercelConfig, VercelError } from "./vercel";

const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

type SourceRecord = {
  id: number;
  site_id: number;
  kind: string;
  label: string;
  config_enc: string;
  last_success_at: string | null;
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
  // Reporting window depends on the Vercel plan; try the longest first.
  const windows = src.last_success_at ? [35] : [730, 365, 90, 30];
  let lastErr: unknown = null;

  for (const w of windows) {
    const since = day(-w);
    try {
      const { points, raw } = await fetchDaily(cfg, since, until);
      const rows = points.map((p) => ({ date: p.date, visitors: p.visitors, pageviews: p.pageviews, bounce_rate: null }));
      if (rows.length) await upsertMetrics(src.site_id, "day", rows, `vercel:${src.id}`);
      await recordSnapshot({
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
      });
      await q("UPDATE sources SET last_success_at = now(), last_error = NULL WHERE id = $1", [src.id]);
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

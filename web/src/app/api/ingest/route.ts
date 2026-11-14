import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { HttpError } from "@/lib/auth";
import { handle } from "@/lib/api";
import { recordSnapshot, upsertMetrics } from "@/lib/data";
import { q, q1 } from "@/lib/db";

/**
 * Push API: send numbers from anything (your own analytics, a cron job, a spreadsheet script).
 *
 *   POST /api/ingest
 *   Authorization: Bearer ks_...
 *   { "date": "2026-11-12", "visitors": 120, "pageviews": 300, "bounce_rate": 41.5,
 *     "pages": [{ "key": "/blog", "visitors": 40, "pageviews": 70 }],
 *     "referrers": [...], "countries": [...], "devices": [...] }
 *
 * or many days at once: { "rows": [ { "date": ..., "visitors": ... }, ... ] }  (up to 5,000)
 * "date" defaults to today (UTC). Sending a date again replaces it.
 */
type Item = { key?: unknown; visitors?: unknown; pageviews?: unknown };
type Row = {
  date?: unknown; visitors?: unknown; pageviews?: unknown; bounce_rate?: unknown;
  pages?: Item[]; referrers?: Item[]; countries?: Item[]; devices?: Item[];
};

const DIMS: [keyof Row, string][] = [["pages", "requestPath"], ["referrers", "referrerHostname"], ["countries", "country"], ["devices", "deviceType"]];
const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);

export const POST = handle(async (req: Request) => {
  const key = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "")?.[1];
  if (!key) throw new HttpError(401, "Send your push key as: Authorization: Bearer ks_...");
  const src = await q1<{ id: number; site_id: number; label: string; active: boolean }>(
    "SELECT id, site_id, label, active FROM sources WHERE ingest_hash = $1 AND kind = 'push'",
    [createHash("sha256").update(key).digest("hex")]
  );
  if (!src) throw new HttpError(401, "Unknown push key. It may have been disconnected; create a new one under Sources.");
  if (!src.active) throw new HttpError(409, "This push source is paused in KeepStat.");

  let payload: Row & { rows?: Row[] };
  try {
    payload = await req.json();
  } catch {
    throw new HttpError(400, "Expected a JSON body.");
  }
  const input = Array.isArray(payload.rows) ? payload.rows : [payload];
  if (!input.length || input.length > 5000) throw new HttpError(400, "Send between 1 and 5,000 rows.");

  const today = new Date().toISOString().slice(0, 10);
  const rows = input.map((r, i) => {
    const date = r.date == null ? today : String(r.date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new HttpError(400, `Row ${i + 1}: date must be YYYY-MM-DD.`);
    const v = num(r.visitors), p = num(r.pageviews), b = num(r.bounce_rate);
    if ([v, p, b].some((x) => Number.isNaN(x) || (x != null && x < 0))) throw new HttpError(400, `Row ${i + 1}: numbers must be zero or more.`);
    if (v == null && p == null) throw new HttpError(400, `Row ${i + 1}: send visitors and/or pageviews.`);
    if (b != null && b > 100) throw new HttpError(400, `Row ${i + 1}: bounce_rate is a percentage (0–100).`);
    return { date, visitors: v, pageviews: p, bounce_rate: b, raw: r };
  });

  await upsertMetrics(src.site_id, "day", rows, `push:${src.id}`);

  // optional breakdowns, stored per day like the connectors do
  let details = 0;
  for (const r of rows) {
    for (const [field, dim] of DIMS) {
      const list = r.raw[field];
      if (!Array.isArray(list) || !list.length) continue;
      const items = list.slice(0, 100).map((x) => ({ key: String(x.key ?? "").slice(0, 300) || "(unknown)", v: Math.round(Number(x.visitors) || 0), p: Math.round(Number(x.pageviews ?? x.visitors) || 0) }));
      await q("DELETE FROM breakdowns WHERE site_id = $1 AND dimension = $2 AND date_from = $3 AND date_to = $3", [src.site_id, dim, r.date]);
      await q(
        `INSERT INTO breakdowns (site_id, dimension, date_from, date_to, key, visitors, pageviews)
         SELECT $1, $2, $3, $3, t.k, SUM(t.v), SUM(t.p) FROM unnest($4::text[], $5::int[], $6::int[]) AS t(k, v, p) GROUP BY t.k`,
        [src.site_id, dim, r.date, items.map((x) => x.key), items.map((x) => x.v), items.map((x) => x.p)]
      );
      details += items.length;
    }
  }

  const sorted = rows.map((r) => r.date).sort();
  await Promise.all([
    q("UPDATE sources SET last_success_at = now(), last_error = NULL WHERE id = $1", [src.id]),
    recordSnapshot({
      siteId: src.site_id,
      sourceId: src.id,
      kind: "push",
      label: src.label,
      status: "ok",
      rows: rows.length,
      rangeFrom: sorted[0],
      rangeTo: sorted.at(-1),
      visitors: rows.reduce((a, r) => a + (r.visitors ?? 0), 0),
    }),
  ]);
  return NextResponse.json({ ok: true, days: rows.length, details });
});

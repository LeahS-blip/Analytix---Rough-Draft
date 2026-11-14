/**
 * Plausible Stats API v2 (plausible.io or self-hosted).
 * Docs: https://plausible.io/docs/stats-api  ·  600 requests/hour per key.
 */
import { getJson, need, ProviderError, refKey, deviceKey, type Dimension, type Provider } from "./types.ts";

export type PlausibleConfig = { key: string; siteId: string; base: string };

const DIM: Record<Dimension, string> = {
  requestPath: "event:page",
  referrerHostname: "visit:source",
  country: "visit:country",
  deviceType: "visit:device",
};

type Res = { results?: { dimensions: (string | null)[]; metrics: (number | null)[] }[] };

function base(raw: string | undefined) {
  const b = (raw || "").trim().replace(/\/+$/, "");
  return b || process.env.KEEPSTAT_PLAUSIBLE_API || "https://plausible.io";
}

function query(cfg: PlausibleConfig, body: Record<string, unknown>) {
  return getJson<Res>("Plausible", `${cfg.base}/api/v2/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ site_id: cfg.siteId, ...body }),
    authHint: "Plausible rejected the key. Create a Stats API key (Settings → API keys) for the team that owns this site.",
  });
}

export const plausible: Provider<PlausibleConfig> = {
  kind: "plausible",
  name: "Plausible",
  backfill: [3650],
  refetch: 35,
  breakdowns: "range",
  async configure(f) {
    const cfg = { key: need(f, "key", "Plausible Stats API key"), siteId: need(f, "site", "site domain").replace(/^https?:\/\//, "").replace(/\/.*$/, ""), base: base(f.base) };
    // one tiny query proves the key and the site both work
    await query(cfg, { metrics: ["visitors"], date_range: "7d" }).catch((e) => {
      if (e instanceof ProviderError && e.status === 400) throw new ProviderError(400, `Plausible: ${e.message} Check the site domain matches Plausible exactly.`);
      throw e;
    });
    return { cfg, label: `Plausible · ${cfg.siteId}` };
  },
  async fetchDaily(cfg, since, until) {
    const r = await query(cfg, {
      metrics: ["visitors", "pageviews", "bounce_rate"],
      date_range: [since, until],
      dimensions: ["time:day"],
      include: { imports: true },
      pagination: { limit: 10000 },
    });
    const points = (r.results ?? []).map((x) => ({
      date: String(x.dimensions[0]).slice(0, 10),
      visitors: Number(x.metrics[0] ?? 0),
      pageviews: x.metrics[1] == null ? null : Number(x.metrics[1]),
      bounce_rate: x.metrics[2] == null || (!x.metrics[0] && !x.metrics[1]) ? null : Number(x.metrics[2]),
    }));
    return { points, raw: r };
  },
  async fetchBreakdown(cfg, dim, since, until, limit) {
    // pageviews only exist for page-level dimensions; visit dimensions report visitors
    const isPage = dim === "requestPath";
    const r = await query(cfg, {
      metrics: isPage ? ["visitors", "pageviews"] : ["visitors"],
      date_range: [since, until],
      dimensions: [DIM[dim]],
      order_by: [["visitors", "desc"]],
      pagination: { limit },
    });
    return (r.results ?? []).map((x) => {
      const raw = x.dimensions[0];
      const key = dim === "referrerHostname" ? refKey(raw) : dim === "deviceType" ? deviceKey(raw) : String(raw ?? "(unknown)") || "(unknown)";
      const visitors = Number(x.metrics[0] ?? 0);
      return { key, visitors, pageviews: isPage ? Number(x.metrics[1] ?? 0) : visitors };
    });
  },
};

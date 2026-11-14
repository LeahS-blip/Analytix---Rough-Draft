/**
 * Cloudflare Web Analytics (the free, cookieless beacon) via the GraphQL Analytics API.
 * Token needs "Account Analytics: Read". Cloudflare keeps about 6 months of this data.
 */
import { eachChunk, getJson, need, ProviderError, refKey, deviceKey, type Dimension, type Provider } from "./types.ts";

export type CloudflareConfig = { token: string; accountId: string; siteTag: string; host: string };

const API = () => process.env.KEEPSTAT_CLOUDFLARE_API || "https://api.cloudflare.com/client/v4";
const HINT = "Cloudflare rejected the token. Create an API token with Account → Account Analytics → Read.";

function rest<T>(token: string, path: string) {
  return getJson<{ success: boolean; result: T; errors?: { message: string }[] }>("Cloudflare", API() + path, {
    headers: { Authorization: `Bearer ${token}` },
    authHint: HINT,
  }).then((r) => r.result);
}

type Group = { count: number; sum?: { visits?: number }; dimensions: Record<string, string> };

async function gql(cfg: CloudflareConfig, dims: string, since: string, until: string, limit: number, order: string): Promise<Group[]> {
  const query = `query($account: string!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject) {
    viewer { accounts(filter: { accountTag: $account }) {
      rumPageloadEventsAdaptiveGroups(limit: ${limit}, filter: $filter, orderBy: [${order}]) {
        count sum { visits } dimensions { ${dims} }
      } } } }`;
  const r = await getJson<{ data?: { viewer?: { accounts?: { rumPageloadEventsAdaptiveGroups?: Group[] }[] } }; errors?: { message: string }[] | null }>(
    "Cloudflare",
    API() + "/graphql",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { account: cfg.accountId, filter: { AND: [{ date_geq: since, date_leq: until }, { siteTag: cfg.siteTag }] } },
      }),
      authHint: HINT,
    }
  );
  if (r.errors?.length) {
    const msg = r.errors[0].message;
    // e.g. "cannot request data older than 182 days"
    throw new ProviderError(/older than|too far|time range/i.test(msg) ? 400 : 502, `Cloudflare: ${msg}`);
  }
  return r.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups ?? [];
}

const DIM: Record<Dimension, string> = { requestPath: "requestPath", referrerHostname: "refererHost", country: "countryName", deviceType: "deviceType" };

export const cloudflare: Provider<CloudflareConfig> = {
  kind: "cloudflare",
  name: "Cloudflare",
  backfill: [180, 90, 30],
  refetch: 35,
  breakdowns: "range",
  shownDays: 180,
  async options(f) {
    const token = need(f, "token", "Cloudflare API token");
    const accounts = await rest<{ id: string; name: string }[]>(token, "/accounts?per_page=50");
    const out: { id: string; label: string; sub?: string }[] = [];
    for (const a of accounts) {
      const sites = await rest<{ site_tag: string; host?: string; ruleset?: { zone_name?: string } }[]>(token, `/accounts/${a.id}/rum/site_info/list?per_page=100`).catch(() => []);
      for (const s of sites) {
        const host = s.host || s.ruleset?.zone_name || s.site_tag;
        out.push({ id: JSON.stringify([a.id, s.site_tag, host]), label: host, sub: a.name });
      }
    }
    if (!out.length) throw new ProviderError(404, "No Web Analytics sites found. Turn on Web Analytics for a site in Cloudflare first.");
    return out;
  },
  async configure(f, choice) {
    if (!choice) throw new ProviderError(400, "Pick a site first.");
    const [accountId, siteTag, host] = JSON.parse(choice) as [string, string, string];
    return { cfg: { token: need(f, "token", "Cloudflare API token"), accountId, siteTag, host }, label: `Cloudflare · ${host}` };
  },
  async fetchDaily(cfg, since, until) {
    const points: { date: string; visitors: number; pageviews: number }[] = [];
    // Cloudflare caps how wide one query may be, so read a month at a time (oldest first).
    for (const [a, b] of eachChunk(since, until, 31)) {
      try {
        const groups = await gql(cfg, "date", a, b, 100, "date_ASC");
        for (const g of groups) points.push({ date: g.dimensions.date, visitors: g.sum?.visits ?? 0, pageviews: g.count });
      } catch (e) {
        // Older than Cloudflare keeps: skip that chunk, keep the rest.
        if (e instanceof ProviderError && e.status === 400 && b < until) continue;
        throw e;
      }
    }
    return { points, raw: { days: points.length } };
  },
  async fetchBreakdown(cfg, dim, since, until, limit) {
    const groups = await gql(cfg, DIM[dim], since, until, limit, "count_DESC");
    return groups.map((g) => {
      const raw = g.dimensions[DIM[dim]];
      const key = dim === "referrerHostname" ? refKey(raw) : dim === "deviceType" ? deviceKey(raw) : String(raw ?? "") || "(unknown)";
      return { key, visitors: g.sum?.visits ?? 0, pageviews: g.count };
    });
  },
};

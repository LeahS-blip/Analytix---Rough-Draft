/**
 * GitHub repository traffic. GitHub only keeps 14 days of views, referrers and
 * popular pages, so this is exactly the kind of history that disappears.
 * Token: a fine-grained token with "Administration: Read" on the repo, or a classic token with `repo`.
 */
import { getJson, need, ProviderError, refKey, type Provider } from "./types.ts";

export type GithubConfig = { token: string; repo: string };

const API = () => process.env.KEEPSTAT_GITHUB_API || "https://api.github.com";
const HINT = "GitHub rejected the token, or it can't see traffic. Traffic needs push access: a fine-grained token with Administration (read) on the repo, or a classic token with the repo scope.";

function gh<T>(token: string, path: string) {
  return getJson<T>("GitHub", API() + path, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    authHint: HINT,
  });
}

export const github: Provider<GithubConfig> = {
  kind: "github",
  name: "GitHub",
  backfill: [14],
  refetch: 14,
  breakdowns: "window",
  windowDays: 14,
  shownDays: 14,
  async options(f) {
    const token = need(f, "token", "GitHub token");
    const repos = await gh<{ full_name: string; private: boolean; permissions?: { push?: boolean } }[]>(token, "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member");
    const out = repos.filter((r) => r.permissions?.push !== false).map((r) => ({ id: r.full_name, label: r.full_name, sub: r.private ? "private" : "public" }));
    if (!out.length) throw new ProviderError(404, "No repositories with push access found for this token.");
    return out;
  },
  async configure(f, choice) {
    const repo = (choice || need(f, "repo", "repository (owner/name)")).replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new ProviderError(400, "Use the form owner/name, e.g. vercel/next.js.");
    const cfg = { token: need(f, "token", "GitHub token"), repo };
    await gh(cfg.token, `/repos/${repo}/traffic/views?per=day`);
    return { cfg, label: `GitHub · ${repo}` };
  },
  async fetchDaily(cfg) {
    const r = await gh<{ views: { timestamp: string; count: number; uniques: number }[] }>(cfg.token, `/repos/${cfg.repo}/traffic/views?per=day`);
    return { points: r.views.map((v) => ({ date: v.timestamp.slice(0, 10), visitors: v.uniques, pageviews: v.count })), raw: r };
  },
  async fetchBreakdown(cfg, dim) {
    if (dim === "requestPath") {
      const r = await gh<{ path: string; count: number; uniques: number }[]>(cfg.token, `/repos/${cfg.repo}/traffic/popular/paths`);
      const prefix = `/${cfg.repo}`;
      return r.map((p) => ({ key: p.path.startsWith(prefix) ? p.path.slice(prefix.length) || "/" : p.path, visitors: p.uniques, pageviews: p.count }));
    }
    if (dim === "referrerHostname") {
      const r = await gh<{ referrer: string; count: number; uniques: number }[]>(cfg.token, `/repos/${cfg.repo}/traffic/popular/referrers`);
      return r.map((p) => ({ key: refKey(p.referrer), visitors: p.uniques, pageviews: p.count }));
    }
    return []; // GitHub has no country or device data
  },
};

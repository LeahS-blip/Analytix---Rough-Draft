/**
 * Umami: Umami Cloud (API key) or self-hosted (username + password).
 * Docs: https://umami.is/docs/api
 */
import { getJson, need, ProviderError, refKey, deviceKey, type Dimension, type Fields, type Provider } from "./types.ts";

export type UmamiConfig = {
  base: string; // ends in /v1 (cloud) or /api (self-hosted)
  apiKey?: string;
  username?: string;
  password?: string;
  websiteId: string;
};

const CLOUD = () => process.env.KEEPSTAT_UMAMI_API || "https://api.umami.is/v1";

function baseFrom(f: Fields): string {
  const raw = (f.base || "").trim().replace(/\/+$/, "");
  if (!raw) return CLOUD();
  if (/\/(api|v1)$/.test(raw)) return raw;
  return raw + "/api";
}

const tokens = new Map<string, { token: string; at: number }>();

async function headers(cfg: Omit<UmamiConfig, "websiteId">): Promise<Record<string, string>> {
  if (cfg.apiKey) return { "x-umami-api-key": cfg.apiKey };
  if (!cfg.username || !cfg.password) throw new ProviderError(400, "Enter an Umami API key, or a username and password for self-hosted Umami.");
  const k = `${cfg.base}|${cfg.username}`;
  const hit = tokens.get(k);
  if (hit && Date.now() - hit.at < 30 * 60_000) return { Authorization: `Bearer ${hit.token}` };
  const r = await getJson<{ token: string }>("Umami", `${cfg.base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: cfg.username, password: cfg.password }),
    authHint: "Umami rejected the username or password.",
  });
  tokens.set(k, { token: r.token, at: Date.now() });
  return { Authorization: `Bearer ${r.token}` };
}

async function get<T>(cfg: Omit<UmamiConfig, "websiteId">, path: string, params: Record<string, string> = {}) {
  const u = new URL(cfg.base + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return getJson<T>("Umami", u.toString(), {
    headers: await headers(cfg),
    authHint: "Umami rejected the credentials. For Umami Cloud, create an API key under Settings → API keys.",
  });
}

const ms = (d: string, end = false) => String(Date.parse(d + (end ? "T23:59:59.999Z" : "T00:00:00Z")));
const xDay = (x: string) => String(x).replace(" ", "T").slice(0, 10);

function creds(f: Fields): Omit<UmamiConfig, "websiteId"> {
  const base = baseFrom(f);
  const apiKey = (f.apiKey || "").trim() || undefined;
  return apiKey ? { base, apiKey } : { base, username: (f.username || "").trim(), password: f.password || "" };
}

export const umami: Provider<UmamiConfig> = {
  kind: "umami",
  name: "Umami",
  backfill: [3650],
  refetch: 35,
  breakdowns: "range",
  async options(f) {
    const c = creds(f);
    const r = await get<{ data?: { id: string; name: string; domain: string }[] } | { id: string; name: string; domain: string }[]>(c, "/websites", { pageSize: "100" });
    const list = Array.isArray(r) ? r : r.data ?? [];
    if (!list.length) throw new ProviderError(404, "No websites found for these credentials.");
    return list.map((w) => ({ id: w.id, label: w.name || w.domain, sub: w.domain }));
  },
  async configure(f, choice) {
    if (!choice) throw new ProviderError(400, "Pick a website first.");
    const c = creds(f);
    const w = await get<{ name?: string; domain?: string }>(c, `/websites/${choice}`);
    return { cfg: { ...c, websiteId: choice }, label: `Umami · ${w.domain || w.name || choice}` };
  },
  async fetchDaily(cfg, since, until) {
    const r = await get<{ pageviews: { x: string; y: number }[]; sessions: { x: string; y: number }[] }>(cfg, `/websites/${cfg.websiteId}/pageviews`, {
      startAt: ms(since),
      endAt: ms(until, true),
      unit: "day",
      timezone: "UTC",
    });
    const by = new Map<string, { v: number; p: number }>();
    for (const s of r.sessions ?? []) by.set(xDay(s.x), { v: Number(s.y) || 0, p: 0 });
    for (const p of r.pageviews ?? []) {
      const e = by.get(xDay(p.x)) ?? { v: 0, p: 0 };
      e.p = Number(p.y) || 0;
      by.set(xDay(p.x), e);
    }
    const points = [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, x]) => ({ date, visitors: x.v, pageviews: x.p }));
    return { points, raw: r };
  },
  async fetchBreakdown(cfg, dim, since, until, limit) {
    const types: Record<Dimension, string[]> = { requestPath: ["path", "url"], referrerHostname: ["referrer"], country: ["country"], deviceType: ["device"] };
    let rows: { x: string | null; y: number }[] = [];
    for (const type of types[dim]) {
      try {
        rows = await get(cfg, `/websites/${cfg.websiteId}/metrics`, { startAt: ms(since), endAt: ms(until, true), type, limit: String(limit) });
        if (rows.length) break;
      } catch (e) {
        if (type === types[dim].at(-1)) throw e; // older Umami calls pages "url", newer "path"
      }
    }
    return rows.map((r) => {
      const key = dim === "referrerHostname" ? refKey(r.x) : dim === "deviceType" ? deviceKey(r.x) : String(r.x ?? "") || "(unknown)";
      return { key, visitors: Number(r.y) || 0, pageviews: Number(r.y) || 0 };
    });
  },
};

/**
 * Vercel Web Analytics client.
 * Docs: https://vercel.com/docs/analytics/web-analytics-api
 * Needs a personal/team access token (integration OAuth tokens lack the analytics scope).
 */
import {
  ProviderError,
  isoDay,
  need,
  type BreakdownRow,
  type Choice,
  type DailyPoint,
  type Dimension,
  type Fields,
  type Provider,
} from "./providers/types.ts";

export { DIMENSIONS, type Dimension, type BreakdownRow, type DailyPoint } from "./providers/types.ts";

// KEEPSTAT_VERCEL_API lets local tests point at a stand-in for Vercel (scripts/mock-vercel.mjs).
const API = () => process.env.KEEPSTAT_VERCEL_API || "https://api.vercel.com";

export type VercelConfig = {
  token: string;
  projectId: string;
  projectName: string;
  teamId?: string | null;
};

export type VercelProject = { projectId: string; name: string; teamId: string | null; teamName: string };

/** Kept for older imports; every provider error is a ProviderError. */
export const VercelError = ProviderError;
export type VercelError = ProviderError;

async function call<T>(token: string, path: string, params: Record<string, string | undefined | null>): Promise<T> {
  const url = new URL(API() + path);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "keepstat/0.2" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const msg =
      res.status === 401 || res.status === 403
        ? "Vercel rejected the token. Use a personal access token with access to this project's team."
        : (body as { error?: { message?: string } })?.error?.message ||
          (res.status === 404
          ? "Project not found, or Web Analytics isn't enabled for it."
          : `Vercel returned HTTP ${res.status}.`);
    throw new ProviderError(res.status, msg);
  }
  return body as T;
}

/** All projects the token can see: personal account plus every team. */
export async function listProjects(token: string): Promise<VercelProject[]> {
  const teams = await call<{ teams: { id: string; name: string; slug: string }[] }>(token, "/v2/teams", {
    limit: "50",
  }).catch(() => ({ teams: [] }));
  const scopes: { teamId: string | null; teamName: string }[] = [
    { teamId: null, teamName: "Personal" },
    ...teams.teams.map((t) => ({ teamId: t.id, teamName: t.name || t.slug })),
  ];
  const out: VercelProject[] = [];
  for (const s of scopes) {
    try {
      const r = await call<{ projects: { id: string; name: string }[] }>(token, "/v9/projects", {
        limit: "100",
        teamId: s.teamId,
      });
      for (const p of r.projects) out.push({ projectId: p.id, name: p.name, teamId: s.teamId, teamName: s.teamName });
    } catch (e) {
      // Personal scope can be empty/forbidden for team-only tokens; surface only if nothing works.
      if (s.teamId === null && scopes.length === 1) throw e;
    }
  }
  if (!out.length) throw new ProviderError(404, "No projects found for this token.");
  return out;
}

/** Daily visitors and page views between two YYYY-MM-DD dates (inclusive). */
export async function fetchDaily(cfg: VercelConfig, since: string, until: string): Promise<{ points: DailyPoint[]; raw: unknown }> {
  const body = await call<{ data?: { timestamp: string; visitors?: number; pageviews?: number }[] }>(
    cfg.token,
    "/v1/query/web-analytics/visits/aggregate",
    { projectId: cfg.projectId, teamId: cfg.teamId, since, until, by: "day" }
  );
  const points = (body?.data ?? [])
    .filter((r) => r && r.timestamp)
    .map((r) => ({
      date: String(r.timestamp).slice(0, 10),
      visitors: Number(r.visitors ?? 0),
      pageviews: Number(r.pageviews ?? 0),
    }));
  return { points, raw: body };
}

/**
 * Top values of one dimension between two YYYY-MM-DD dates (inclusive), e.g. the top
 * pages for a day. Vercel groups anything past `limit` into an "Others" row, which we keep.
 */
export async function fetchBreakdown(
  cfg: VercelConfig,
  dimension: Dimension,
  since: string,
  until: string,
  limit = 25
): Promise<BreakdownRow[]> {
  const body = await call<{ data?: Record<string, unknown>[] }>(cfg.token, "/v1/query/web-analytics/visits/aggregate", {
    projectId: cfg.projectId,
    teamId: cfg.teamId,
    since,
    until,
    by: dimension,
    limit: String(limit),
  });
  return (body?.data ?? [])
    .map((r) => ({
      key: String(r[dimension] ?? "").trim() || (dimension === "referrerHostname" ? "(direct)" : "(unknown)"),
      visitors: Number(r.visitors ?? 0),
      pageviews: Number(r.pageviews ?? 0),
    }))
    .filter((r) => r.visitors > 0 || r.pageviews > 0);
}

/**
 * The plan limit Vercel reports when a range reaches too far back, e.g.
 * "Invalid request: the hobby plan only grants access to the latest 31 days of data." → 31
 */
export function planLimitDays(e: unknown): number | null {
  if (!(e instanceof ProviderError)) return null;
  const m = /latest\s+(\d+)\s+days/i.exec(e.message);
  return m ? Number(m[1]) : null;
}

/**
 * Daily data for the last `days` days, ending today. If the range is longer
 * than the plan allows, retry once with the range the provider says it allows.
 */
export async function fetchRecentDaysWith<C>(
  p: Pick<Provider<C>, "fetchDaily" | "planLimitDays">,
  cfg: C,
  days: number
): Promise<{ points: DailyPoint[]; raw: unknown; days: number }> {
  try {
    return { ...(await p.fetchDaily(cfg, isoDay(-days), isoDay(0))), days };
  } catch (e) {
    const limit = p.planLimitDays?.(e) ?? null;
    if (limit == null || limit - 1 >= days) throw e;
    const allowed = Math.max(1, limit - 1); // "latest 31 days" = today and the 30 before it
    return { ...(await p.fetchDaily(cfg, isoDay(-allowed), isoDay(0))), days: allowed };
  }
}

export const fetchRecentDays = (cfg: VercelConfig, days: number) => fetchRecentDaysWith(vercel, cfg, days);

export const vercel: Provider<VercelConfig> = {
  kind: "vercel",
  name: "Vercel",
  backfill: [730, 365, 90, 30],
  refetch: 35,
  breakdowns: "range",
  async options(f: Fields): Promise<Choice[]> {
    const ps = await listProjects(need(f, "token", "Vercel access token"));
    return ps.map((p) => ({ id: JSON.stringify([p.projectId, p.teamId, p.name]), label: p.name, sub: p.teamName }));
  },
  async configure(f, choice) {
    if (!choice) throw new ProviderError(400, "Pick a Vercel project first.");
    const [projectId, teamId, name] = JSON.parse(choice) as [string, string | null, string];
    const cfg: VercelConfig = { token: need(f, "token", "Vercel access token"), projectId, projectName: name || projectId, teamId };
    return { cfg, label: `Vercel · ${cfg.projectName}` };
  },
  fetchDaily,
  fetchBreakdown,
  planLimitDays,
};

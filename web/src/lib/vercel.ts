/**
 * Vercel Web Analytics client.
 * Docs: https://vercel.com/docs/analytics/web-analytics-api
 * Needs a personal/team access token (integration OAuth tokens lack the analytics scope).
 */

const API = "https://api.vercel.com";

export type VercelConfig = {
  token: string;
  projectId: string;
  projectName: string;
  teamId?: string | null;
};

export type VercelProject = { projectId: string; name: string; teamId: string | null; teamName: string };

export class VercelError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(token: string, path: string, params: Record<string, string | undefined | null>): Promise<T> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "keepstat/0.1" },
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
    throw new VercelError(res.status, msg);
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
  if (!out.length) throw new VercelError(404, "No projects found for this token.");
  return out;
}

export type DailyPoint = { date: string; visitors: number; pageviews: number };

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

/** What every analytics connector provides, so snapshots and the UI don't care which one it is. */

export class ProviderError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type DailyPoint = { date: string; visitors: number; pageviews: number | null; bounce_rate?: number | null };

/** The breakdowns KeepStat keeps, under one name whichever provider they came from. */
export const DIMENSIONS = ["requestPath", "referrerHostname", "country", "deviceType"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type BreakdownRow = { key: string; visitors: number; pageviews: number };

export type Fields = Record<string, string>;
export type Choice = { id: string; label: string; sub?: string };

export interface Provider<C = unknown> {
  kind: string;
  name: string;
  /** Windows (days) tried on the first run, longest first. */
  backfill: number[];
  /** Days re-read on later runs, so late numbers get corrected. */
  refetch: number;
  /**
   * How breakdowns can be read: "range" = any date range (one row set per day),
   * "window" = only a fixed recent window (stored as non-overlapping blocks), "none".
   */
  breakdowns: "range" | "window" | "none";
  /** For "window" providers, the window length in days. */
  windowDays?: number;
  /** How many days the provider itself shows, if fixed (shown as "days X no longer shows"). */
  shownDays?: number;
  /** Things the user picks from after entering credentials (projects, websites, properties). */
  options?(f: Fields): Promise<Choice[]>;
  /** Validate the credentials + choice and return the config to encrypt, and a label. */
  configure(f: Fields, choice: string | null): Promise<{ cfg: C; label: string }>;
  fetchDaily(cfg: C, since: string, until: string): Promise<{ points: DailyPoint[]; raw: unknown }>;
  fetchBreakdown?(cfg: C, dim: Dimension, since: string, until: string, limit: number): Promise<BreakdownRow[]>;
  /** If an error says "you may only read N days", return N - 1 (today plus the N - 1 before). */
  planLimitDays?(e: unknown): number | null;
}

export const isoDay = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

export function need(f: Fields, key: string, what: string): string {
  const v = (f[key] ?? "").trim();
  if (!v) throw new ProviderError(400, `Enter your ${what}.`);
  return v;
}

/** fetch + JSON + a readable error. `who` names the service in messages. */
export async function getJson<T>(
  who: string,
  url: string,
  init: RequestInit & { authHint?: string } = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "User-Agent": "keepstat/0.2", Accept: "application/json", ...(init.headers || {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new ProviderError(502, `Couldn't reach ${who}. Check the address and try again.`);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const b = body as { error?: unknown; message?: unknown; errors?: { message?: string }[] } | null;
    const nested = b?.error && typeof b.error === "object" ? (b.error as { message?: unknown }).message : undefined;
    const detail: string =
      (typeof b?.error === "string" ? b.error : "") ||
      (typeof nested === "string" ? nested : "") ||
      (typeof b?.message === "string" ? b.message : "") ||
      (Array.isArray(b?.errors) ? b.errors[0]?.message ?? "" : "");
    const msg =
      res.status === 401 || res.status === 403
        ? init.authHint || `${who} rejected the key.${detail ? ` (${detail})` : ""}`
        : detail || `${who} returned HTTP ${res.status}.`;
    throw new ProviderError(res.status, msg);
  }
  return body as T;
}

/** Normalise referrer keys so "(direct)" means the same thing everywhere. */
export function refKey(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s || /^(direct|\(direct\)|direct \/ none|\(none\)|none)$/i.test(s)) return "(direct)";
  return s.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

export function deviceKey(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "(unknown)";
  if (s === "laptop" || s === "desktop") return "desktop";
  if (s === "smartphone" || s === "phone") return "mobile";
  return s;
}

export function eachChunk(since: string, until: string, days: number): [string, string][] {
  const out: [string, string][] = [];
  let a = Date.parse(since);
  const end = Date.parse(until);
  while (a <= end) {
    const b = Math.min(end, a + (days - 1) * 864e5);
    out.push([new Date(a).toISOString().slice(0, 10), new Date(b).toISOString().slice(0, 10)]);
    a = b + 864e5;
  }
  return out;
}

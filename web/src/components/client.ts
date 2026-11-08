"use client";

export type ApiResult<T> = T | { error: string };

export async function api<T = { ok: true }>(url: string, method: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || `Request failed (${res.status})` };
    return data as T;
  } catch {
    return { error: "Couldn't reach the server." };
  }
}

export const postJson = <T,>(url: string, body?: unknown) => api<T>(url, "POST", body ?? {});

export const fmt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-06" → "Jun '26" */
export function monthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${MON[+m - 1]} '${y.slice(2)}`;
}
/** "2026-06" → "June 2026" */
export function monthFull(month: string) {
  const [y, m] = month.split("-");
  return `${MONTH_FULL[+m - 1]} ${y}`;
}
/** "2026-06-14" → "Jun 14" */
export function dayLabel(date: string) {
  const [, m, d] = date.split("-");
  return `${MON[+m - 1]} ${+d}`;
}
/** SQLite UTC "YYYY-MM-DD HH:MM:SS" → local readable */
export function stamp(s: string | null) {
  if (!s) return "never";
  const d = new Date(s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z"));
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function ago(s: string | null) {
  if (!s) return "never";
  const d = new Date(s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z"));
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

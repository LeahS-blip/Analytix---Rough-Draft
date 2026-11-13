import type { MetricRow, MonthRow } from "@/lib/data";
import { dayLabel, monthLabel } from "./client";

export type Range = "30d" | "6m" | "1y" | "all";
export const RANGES: { key: Range; label: string }[] = [
  { key: "30d", label: "30D" },
  { key: "6m", label: "6M" },
  { key: "1y", label: "1Y" },
  { key: "all", label: "All" },
];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const daysAgo = (n: number) => {
  const t = new Date();
  return isoDay(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - n)));
};

/** Every month key from `from` to `to` inclusive ("YYYY-MM"). */
export function monthSpan(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function shiftMonth(month: string, delta: number) {
  let [y, m] = month.split("-").map(Number);
  m += delta;
  while (m < 1) {
    m += 12;
    y--;
  }
  while (m > 12) {
    m -= 12;
    y++;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export type Series = {
  labels: string[];
  keys: string[];
  values: (number | null)[];
  prev: (number | null)[];
  edgeAt: number | null;
  granularity: "day" | "month";
  /** The month in progress, kept off the line so a half-month doesn't read as a drop. */
  partial: { label: string; value: number; days: number } | null;
};

/** Under this much history, a monthly chart is one or two dots, so plot days instead. */
const DAILY_UNTIL_DAYS = 120;

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/** Every day from `from` to yesterday, with today shown separately as "so far". */
function dailySeries(from: string, daily: MetricRow[]): Series {
  const byDate = new Map(daily.map((d) => [d.date, d.visitors]));
  const today = daysAgo(0);
  const end = daysAgo(1);
  const n = Math.max(2, dayDiff(from, end) + 1);
  const keys = Array.from({ length: n }, (_, i) => daysAgo(dayDiff(from, today) - i));
  const yearAgo = (k: string) => new Date(Date.parse(k) - 365 * 864e5).toISOString().slice(0, 10);
  const edge = daysAgo(30);
  const ei = keys.indexOf(edge);
  const todayVal = byDate.get(today);
  return {
    labels: keys.map(dayLabel),
    keys,
    values: keys.map((k) => byDate.get(k) ?? null),
    prev: keys.map((k) => byDate.get(yearAgo(k)) ?? null),
    edgeAt: ei > 0 ? ei : null,
    granularity: "day",
    partial: todayVal != null ? { label: "Today", value: todayVal, days: 1 } : null,
  };
}

export function buildSeries(range: Range, daily: MetricRow[], monthly: MonthRow[]): Series {
  // Short history (e.g. a new Vercel connection on the free plan, ~30 days): show days, not months.
  const firstDay = daily[0]?.date;
  // Only imported monthly totals count as older history (summary rows built from days start on the 1st).
  const firstImportedMonth = monthly.find((m) => m.granularity === "month")?.date;
  const firstAny = [firstDay, firstImportedMonth].filter(Boolean).sort()[0];
  if (range !== "30d" && firstDay && firstAny === firstDay && dayDiff(firstDay, daysAgo(0)) <= DAILY_UNTIL_DAYS) {
    const windowStart = range === "6m" ? daysAgo(182) : range === "1y" ? daysAgo(365) : firstDay;
    const from = windowStart > firstDay ? windowStart : firstDay;
    // at least two weeks wide, so two days of data don't fill the whole chart
    return dailySeries(dayDiff(from, daysAgo(0)) < 14 ? daysAgo(14) : from, daily);
  }
  if (range === "30d") {
    const byDate = new Map(daily.map((d) => [d.date, d.visitors]));
    const keys = Array.from({ length: 30 }, (_, i) => daysAgo(29 - i));
    const prevKeys = Array.from({ length: 30 }, (_, i) => daysAgo(29 - i + 365));
    return {
      labels: keys.map(dayLabel),
      keys,
      values: keys.map((k) => byDate.get(k) ?? null),
      prev: prevKeys.map((k) => byDate.get(k) ?? null),
      edgeAt: null,
      granularity: "day",
      partial: null,
    };
  }
  const byMonth = new Map(monthly.map((m) => [m.month, m.visitors]));
  const thisMonth = daysAgo(0).slice(0, 7);
  const lastFull = shiftMonth(thisMonth, -1);
  const cur = monthly.find((m) => m.month === thisMonth);
  const partial = cur?.visitors != null ? { label: monthLabel(thisMonth), value: cur.visitors, days: cur.days } : null;
  const first = monthly[0]?.month ?? lastFull;
  let keys = monthSpan(first < lastFull ? first : shiftMonth(lastFull, -1), lastFull);
  const want = range === "6m" ? 6 : range === "1y" ? 12 : Infinity;
  if (keys.length > want) keys = keys.slice(-want);
  if (keys.length < 2) keys = monthSpan(shiftMonth(keys[0], -1), keys[0]);

  // Where the provider's rolling 30-day window starts, as a fractional index.
  const edge = daysAgo(30);
  const ei = keys.indexOf(edge.slice(0, 7));
  const edgeAt = ei < 0 ? null : ei + (Number(edge.slice(8, 10)) - 1) / 31;

  return {
    labels: keys.map(monthLabel),
    keys,
    values: keys.map((k) => byMonth.get(k) ?? null),
    prev: keys.map((k) => byMonth.get(shiftMonth(k, -12)) ?? null),
    edgeAt,
    granularity: "month",
    partial,
  };
}

const sum = (rows: MetricRow[], k: "visitors" | "pageviews") =>
  rows.reduce((a, r) => a + (r[k] ?? 0), 0);
const has = (rows: MetricRow[], k: keyof MetricRow) => rows.some((r) => r[k] != null);
const avg = (rows: MetricRow[], k: "bounce_rate") => {
  const v = rows.map((r) => r[k]).filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export type Kpi = { label: string; value: string; delta: number | null; goodWhenUp: boolean; foot: string; spark: number[] };

export function kpis(daily: MetricRow[], monthly: MonthRow[]): { kpis: Kpi[]; basis: string } {
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : null);
  const lifetime = monthly.reduce((a, m) => a + (m.visitors ?? 0), 0);
  const lifetimeKpi: Kpi = {
    label: "Lifetime visitors kept",
    value: fmt(lifetime),
    delta: null,
    goodWhenUp: true,
    foot: monthly.length ? `since ${monthLabel(monthly[0].month)} · ${monthly.length} month${monthly.length === 1 ? "" : "s"}` : "nothing kept yet",
    spark: cumulative(monthly.map((m) => m.visitors ?? 0)).slice(-12),
  };

  const recent = daily.filter((d) => d.date > daysAgo(30));
  if (recent.length) {
    const prior = daily.filter((d) => d.date > daysAgo(60) && d.date <= daysAgo(30));
    const v = sum(recent, "visitors"), pv = sum(recent, "pageviews");
    const pvv = sum(prior, "visitors"), ppv = sum(prior, "pageviews");
    // Compare per-day averages so missing days in either window don't skew the change.
    const pct = (a: number, b: number) => (b ? ((a / recent.length - b / prior.length) / (b / prior.length)) * 100 : null);
    // 7-day rolling averages: shows the trend instead of the weekday/weekend zigzag.
    const smoothFrom = daily.filter((d) => d.date > daysAgo(36));
    const spark = (k: "visitors" | "pageviews" | "bounce_rate") => rolling(smoothFrom.map((r) => r[k] ?? 0), 7);
    const out: Kpi[] = [
      { label: "Visitors · 30 days", value: fmt(v), delta: prior.length ? pct(v, pvv) : null, goodWhenUp: true, foot: prior.length ? `${fmt(v / recent.length)}/day vs. ${fmt(pvv / prior.length)}/day prev 30d` : `${recent.length} days of data`, spark: spark("visitors") },
      { label: "Page views · 30 days", value: has(recent, "pageviews") ? fmt(pv) : "—", delta: prior.length && has(recent, "pageviews") ? pct(pv, ppv) : null, goodWhenUp: true, foot: v && pv ? `${(pv / v).toFixed(2)} per visitor` : "no page-view data", spark: spark("pageviews") },
    ];
    const b = avg(recent, "bounce_rate");
    if (b != null) {
      const pb = avg(prior, "bounce_rate");
      out.push({ label: "Bounce rate", value: b.toFixed(1) + "%", delta: pb ? ((b - pb) / pb) * 100 : null, goodWhenUp: false, foot: "lower is better", spark: spark("bounce_rate") });
    } else {
      out.push({ label: "Days kept", value: fmt(daily.length), delta: null, goodWhenUp: true, foot: daily.length ? `since ${daily[0].date}` : "", spark: [] });
    }
    out.push(lifetimeKpi);
    return { kpis: out, basis: "last 30 days" };
  }

  // No recent daily data: fall back to the latest month we have.
  const m = monthly.at(-1);
  const pm = monthly.at(-2);
  if (!m) return { kpis: [], basis: "" };
  const out: Kpi[] = [
    { label: `Visitors · ${monthLabel(m.month)}`, value: fmt(m.visitors ?? 0), delta: pm?.visitors ? pct(m.visitors ?? 0, pm.visitors) : null, goodWhenUp: true, foot: pm ? `vs. ${fmt(pm.visitors ?? 0)} in ${monthLabel(pm.month)}` : "latest month kept", spark: monthly.slice(-12).map((x) => x.visitors ?? 0) },
    { label: `Page views · ${monthLabel(m.month)}`, value: m.pageviews != null ? fmt(m.pageviews) : "—", delta: pm?.pageviews && m.pageviews != null ? pct(m.pageviews, pm.pageviews) : null, goodWhenUp: true, foot: m.pageviews && m.visitors ? `${(m.pageviews / m.visitors).toFixed(2)} per visitor` : "no page-view data", spark: monthly.slice(-12).map((x) => x.pageviews ?? 0) },
    { label: "Bounce rate", value: m.bounce_rate != null ? m.bounce_rate.toFixed(1) + "%" : "—", delta: m.bounce_rate != null && pm?.bounce_rate ? pct(m.bounce_rate, pm.bounce_rate) : null, goodWhenUp: false, foot: m.bounce_rate != null ? "lower is better" : "no bounce data", spark: monthly.slice(-12).map((x) => x.bounce_rate ?? 0) },
    lifetimeKpi,
  ];
  return { kpis: out, basis: `latest month (${monthLabel(m.month)})` };
}

function rolling(a: number[], w: number) {
  if (a.length <= w) return a;
  const out: number[] = [];
  for (let i = w - 1; i < a.length; i++) out.push(a.slice(i - w + 1, i + 1).reduce((s, v) => s + v, 0) / w);
  return out;
}

function cumulative(a: number[]) {
  let s = 0;
  return a.map((v) => (s += v));
}

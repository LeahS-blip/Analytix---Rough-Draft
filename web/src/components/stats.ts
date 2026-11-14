import type { BreakdownSummary, MetricRow, MonthRow, SourceRow } from "@/lib/data";
import { dayLabel, monthFull, monthLabel } from "./client";
import { providerName } from "./providers";

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

/* ---------------- insights: things a 30-day dashboard can't tell you ---------------- */


export type Insight = {
  kind: "kept" | "spike" | "momentum" | "pace" | "weekday" | "record" | "rising" | "source" | "ai" | "channel" | "newref" | "projection" | "yoy" | "streak" | "bounce" | "growth";
  title: string;
  detail: string;
};

const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const pctTxt = (p: number) => `${p >= 0 ? "up" : "down"} ${Math.abs(Math.round(p))}%`;
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const longDay = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Plain-language findings from the kept history. Each one only appears when there's
 * enough data to say it honestly (e.g. weekday patterns need three full weeks).
 */
export function insights(daily: MetricRow[], sources: SourceRow[], breakdown: BreakdownSummary): Insight[] {
  const out: Insight[] = [];
  const today = daysAgo(0);
  // finished days only (today is still filling up)
  const days = daily.filter((d) => d.date < today && d.visitors != null) as (MetricRow & { visitors: number })[];
  const vis = new Map(days.map((d) => [d.date, d.visitors]));
  const sumRange = (from: number, to: number) => {
    let s = 0, c = 0;
    for (let i = from; i <= to; i++) { const v = vis.get(daysAgo(i)); if (v != null) { s += v; c++; } }
    return { s, c };
  };

  // 1. History the provider no longer shows
  const limited = sources.find((s) => typeof s.max_days === "number");
  const window = limited?.max_days;
  if (limited && window && days.length) {
    const beyond = days.filter((d) => d.date < daysAgo(window)).length;
    const name = providerName(limited.kind);
    const shown = limited.kind === "vercel" ? window + 1 : window;
    if (beyond > 0)
      out.push({ kind: "kept", title: `${n0(beyond)} day${beyond === 1 ? "" : "s"} ${name} no longer shows`, detail: `${name} shows the last ${shown} days. KeepStat still has every day since ${longDay(days[0].date)}.` });
  }

  // 2. Spikes, and who caused them
  const spikes: Insight[] = [];
  days.forEach((d, i) => {
    const before = days.slice(Math.max(0, i - 28), i).map((x) => x.visitors);
    if (before.length < 7) return;
    const base = median(before);
    if (d.visitors >= 10 && base > 0 && d.visitors >= 2 * base) {
      const ref = breakdown.topReferrerByDay[d.date];
      spikes.push({
        kind: "spike",
        title: `${longDay(d.date)}: ${(d.visitors / base).toFixed(1)}× a normal day`,
        detail: ref && ref.share >= 0.2
          ? `${n0(d.visitors)} visitors, ${Math.round(ref.share * 100)}% of them from ${ref.key}.`
          : `${n0(d.visitors)} visitors against a usual ${n0(base)}.`,
      });
    }
  });
  out.push(...spikes.slice(-2).reverse());

  // 3. Momentum: last 7 finished days vs the 7 before
  const a = sumRange(1, 7), b = sumRange(8, 14);
  if (a.c >= 6 && b.c >= 6 && b.s > 0) {
    const p = ((a.s / a.c - b.s / b.c) / (b.s / b.c)) * 100;
    const prevSpike = spikes.map((x) => x.title.split(":")[0]).find((label) => { for (let i = 8; i <= 14; i++) if (longDay(daysAgo(i)) === label) return true; return false; });
    out.push({
      kind: "momentum",
      title: `Last 7 days: ${n0(a.s)} visitors, ${pctTxt(p)}`,
      detail: `Compared with the 7 days before (${n0(b.s)}), per day.${prevSpike && p < 0 ? ` That week included the ${prevSpike} spike.` : ""}`,
    });
  }

  // 4. Pace: this month's daily average vs last month's
  const thisM = today.slice(0, 7), lastM = shiftMonth(thisM, -1);
  const mDays = (m: string) => days.filter((d) => d.date.startsWith(m));
  const tm = mDays(thisM), lm = mDays(lastM);
  if (tm.length >= 3 && lm.length >= 7) {
    const avg = (r: typeof days) => r.reduce((s, d) => s + d.visitors, 0) / r.length;
    const p = ((avg(tm) - avg(lm)) / avg(lm)) * 100;
    out.push({ kind: "pace", title: `${monthFull(thisM).split(" ")[0]} is ${pctTxt(p)} on ${monthFull(lastM).split(" ")[0]}`, detail: `${n0(avg(tm))} visitors a day so far, against ${n0(avg(lm))} a day last month.` });
  }

  // 5. Best weekday (needs 3 full weeks)
  if (days.length >= 21) {
    const by: number[][] = [[], [], [], [], [], [], []];
    days.slice(-84).forEach((d) => by[new Date(d.date + "T00:00:00Z").getUTCDay()].push(d.visitors));
    // medians, so one viral day can't make its weekday look like the best
    const avgs = by.map((x) => (x.length ? median(x) : 0));
    const all = median(days.slice(-84).map((d) => d.visitors));
    const best = avgs.indexOf(Math.max(...avgs)), worst = avgs.indexOf(Math.min(...avgs));
    if (all > 0 && avgs[best] > all * 1.1)
      out.push({ kind: "weekday", title: `${WEEKDAYS[best]} are your best day`, detail: `A typical ${WEEKDAYS[best].slice(0, -1)} is ${Math.round((avgs[best] / all - 1) * 100)}% above a typical day. ${WEEKDAYS[worst]} are the quietest.` });
  }

  // 6. Records
  if (days.length >= 14) {
    const best = days.reduce((m, d) => (d.visitors > m.visitors ? d : m));
    let bestWeek = { end: "", s: -1 };
    for (let i = 6; i < days.length; i++) {
      const s = days.slice(i - 6, i + 1).reduce((t, d) => t + d.visitors, 0);
      if (s > bestWeek.s) bestWeek = { end: days[i].date, s };
    }
    out.push({ kind: "record", title: `Best day kept: ${longDay(best.date)}, ${n0(best.visitors)} visitors`, detail: `Best 7-day run: ${n0(bestWeek.s)} visitors, ending ${longDay(bestWeek.end)}.` });
  }

  // 7. Pages: rising vs the month before, or what leads lately
  const pages = breakdown.dims.requestPath;
  if (pages?.recent.length) {
    const prior = new Map(pages.prior.map((p) => [p.key, p.pageviews]));
    const rising = pages.recent
      .filter((p) => p.key !== "Others" && (prior.get(p.key) ?? 0) >= 5)
      .map((p) => ({ ...p, growth: (p.pageviews - prior.get(p.key)!) / prior.get(p.key)! }))
      .filter((p) => p.growth >= 0.3)
      .sort((x, y) => y.growth - x.growth)[0];
    if (rising) out.push({ kind: "rising", title: `Rising: ${rising.key}`, detail: `${n0(rising.pageviews)} views in the last 30 days, ${pctTxt(rising.growth * 100)} on the 30 before.` });
    else {
      const total = pages.recent.reduce((s, p) => s + p.pageviews, 0);
      const lead = pages.recent.find((p) => p.key !== "Others");
      if (lead && total) out.push({ kind: "rising", title: `Most viewed lately: ${lead.key}`, detail: `${Math.round((lead.pageviews / total) * 100)}% of page views in the last 30 days.` });
    }
  }

  // 8. Where visitors come from
  const refs = breakdown.dims.referrerHostname?.recent.filter((r) => r.key !== "Others");
  if (refs?.length) {
    const total = refs.reduce((s, r) => s + r.visitors, 0);
    const ext = refs.find((r) => r.key !== "(direct)");
    if (ext && total) out.push({ kind: "source", title: `Top referrer: ${ext.key}`, detail: `${Math.round((ext.visitors / total) * 100)}% of visitors in the last 30 days. Direct visits: ${Math.round(((refs.find((r) => r.key === "(direct)")?.visitors ?? 0) / total) * 100)}%.` });
  }

  // 9. AI assistants and channels (which kinds of places send people)
  const refScope = breakdown.dims.referrerHostname?.recent.length ? breakdown.dims.referrerHostname.recent : breakdown.dims.referrerHostname?.all;
  if (refScope?.length) {
    const ch = channels(refScope);
    const total = ch.reduce((s, c) => s + c.visitors, 0);
    const ai = ch.find((c) => c.channel === "AI assistants");
    if (ai && ai.visitors > 0 && total)
      out.push({ kind: "ai", title: `AI assistants sent ${n0(ai.visitors)} visitor${ai.visitors === 1 ? "" : "s"}`, detail: `${pctShare(ai.visitors, total)} of visitors${breakdown.dims.referrerHostname?.recent.length ? " in the last 30 days" : ""}, mostly from ${ai.top}. ChatGPT, Perplexity, Claude, Gemini and Copilot are grouped together here.` });
    const lead = ch.filter((c) => c.channel !== "Direct" && c.channel !== "AI assistants")[0];
    if (lead && total && lead.visitors / total >= 0.1)
      out.push({ kind: "channel", title: `${lead.channel} brings ${pctShare(lead.visitors, total)} of visitors`, detail: ch.filter((c) => c.visitors > 0).map((c) => `${c.channel} ${pctShare(c.visitors, total)}`).join(" · ") });
  }

  // 10. Referrers that never sent anyone before
  const fresh = breakdown.newReferrers?.filter((r) => r.visitors >= 3)[0];
  if (fresh) out.push({ kind: "newref", title: `New: ${fresh.key} started sending visitors`, detail: `${n0(fresh.visitors)} visitors in the last 30 days, and none in all the history kept before that.` });

  // 11. Where this month is heading
  const finishedThis = tm.length;
  const dim = new Date(Date.UTC(Number(thisM.slice(0, 4)), Number(thisM.slice(5, 7)), 0)).getUTCDate();
  const todayNum = Number(today.slice(8, 10));
  if (finishedThis >= 5 && todayNum < dim) {
    // finished days so far, plus the month's daily average for today and the days left
    const so = tm.reduce((s, d) => s + d.visitors, 0);
    const perDay = so / finishedThis;
    const projected = so + perDay * (dim - (todayNum - 1));
    const lastFull = lm.length >= lmDays(lastM) - 1 ? lm.reduce((s, d) => s + d.visitors, 0) : null;
    out.push({
      kind: "projection",
      title: `${monthFull(thisM).split(" ")[0]} is on pace for about ${n0(projected)} visitors`,
      detail: lastFull ? `${monthFull(lastM).split(" ")[0]} finished with ${n0(lastFull)}, so that would be ${pctTxt(((projected - lastFull) / lastFull) * 100)}.` : `Based on ${finishedThis} finished days at ${n0(perDay)} a day.`,
    });
  }

  // 12. Year over year: last 30 finished days vs the same days a year earlier
  {
    let s = 0, c = 0, ps = 0, pc = 0;
    for (let i = 1; i <= 30; i++) {
      const v = vis.get(daysAgo(i)), pv = vis.get(daysAgo(i + 365));
      if (v != null && pv != null) { s += v; c++; ps += pv; pc++; }
    }
    if (c >= 20 && ps > 0)
      out.push({ kind: "yoy", title: `${pctTxt(((s - ps) / ps) * 100).replace(/^./, (m) => m.toUpperCase())} on a year ago`, detail: `${n0(s)} visitors over the last ${c} days, against ${n0(ps)} on the same days last year.` });
  }

  // 13. Growth streak: consecutive weeks each above the one before
  {
    const weeks: number[] = [];
    for (let w = 0; w < 12; w++) {
      const r = sumRange(1 + w * 7, 7 + w * 7);
      if (r.c < 6) break;
      weeks.push(r.s);
    }
    let streak = 0;
    while (streak + 1 < weeks.length && weeks[streak] > weeks[streak + 1]) streak++;
    if (streak >= 3)
      out.push({ kind: "streak", title: `${streak} weeks of growth in a row`, detail: `Every week since ${longDay(daysAgo(streak * 7))} beat the one before: ${n0(weeks[streak])} → ${n0(weeks[0])} visitors a week.` });
  }

  // 14. Bounce rate change (Plausible, GA4, Push API and imports carry it)
  {
    const b = (from: number, to: number) => {
      const v = days.filter((d) => d.date <= daysAgo(from) && d.date >= daysAgo(to) && d.bounce_rate != null).map((d) => d.bounce_rate!);
      return v.length >= 10 ? v.reduce((x, y) => x + y, 0) / v.length : null;
    };
    const now = b(1, 30), before = b(31, 60);
    if (now != null && before != null && Math.abs(now - before) >= 2)
      out.push({ kind: "bounce", title: `Bounce rate ${now < before ? "down" : "up"} to ${now.toFixed(1)}%`, detail: `From ${before.toFixed(1)}% the 30 days before. ${now < before ? "More visitors are staying for a second page." : "More visitors leave after one page."}` });
  }

  // 15. Best month ever (needs a few full months)
  {
    const full = new Map<string, number>();
    for (const d of days) full.set(d.date.slice(0, 7), (full.get(d.date.slice(0, 7)) ?? 0) + d.visitors);
    const counts = new Map<string, number>();
    for (const d of days) counts.set(d.date.slice(0, 7), (counts.get(d.date.slice(0, 7)) ?? 0) + 1);
    const complete = [...full.entries()].filter(([m]) => m < thisM && (counts.get(m) ?? 0) >= lmDays(m) - 1);
    if (complete.length >= 3) {
      const [bm, bv] = complete.reduce((a, b) => (b[1] > a[1] ? b : a));
      if (bm === lastM) out.push({ kind: "growth", title: `${monthFull(bm)} was your best month kept`, detail: `${n0(bv)} visitors, out of ${complete.length} full months.` });
    }
  }

  // Most useful first: what's happening now, then why, then patterns.
  const ORDER: Insight["kind"][] = ["spike", "streak", "momentum", "projection", "yoy", "newref", "ai", "pace", "growth", "kept", "channel", "bounce", "rising", "source", "weekday", "record"];
  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

const lmDays = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
const pctShare = (a: number, total: number) => `${a / total < 0.01 && a > 0 ? "<1" : Math.round((a / total) * 100)}%`;

/* ---------------- channels: what kind of place sent each visitor ---------------- */

export type Channel = "Direct" | "Search" | "Social" | "AI assistants" | "Email" | "Referral";
export const CHANNEL_ORDER: Channel[] = ["Direct", "Search", "Social", "AI assistants", "Email", "Referral"];

const AI = /(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|bard\.google\.com|copilot\.microsoft\.com|you\.com|phind\.com|poe\.com|meta\.ai|chat\.deepseek\.com|deepseek\.com|grok\.com|chat\.mistral\.ai)$|^(chatgpt|perplexity|claude|gemini|copilot|deepseek|grok)$/i;
const SEARCH = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.com|yandex\.[a-z]+|baidu\.com|ecosia\.org|search\.brave\.com|startpage\.com|qwant\.com|kagi\.com|naver\.com)$|^(google|bing|duckduckgo|yahoo!?|yandex|baidu|ecosia|brave|startpage|qwant|kagi|naver)$/i;
const SOCIAL = /(^|\.)(x\.com|twitter\.com|t\.co|facebook\.com|fb\.com|m\.facebook\.com|l\.facebook\.com|instagram\.com|linkedin\.com|lnkd\.in|reddit\.com|news\.ycombinator\.com|youtube\.com|tiktok\.com|pinterest\.[a-z.]+|threads\.net|bsky\.app|mastodon\.social|discord\.com|t\.me|telegram\.org|whatsapp\.com|lobste\.rs|producthunt\.com|dev\.to|medium\.com|substack\.com)$|^(twitter|x|facebook|instagram|linkedin|reddit|hacker news|youtube|tiktok|pinterest|threads|bluesky|mastodon|discord|telegram|whatsapp|product hunt)$/i;
const EMAIL = /(^|\.)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|mail\.yahoo\.com|mail\.proton\.me)$|newsletter|^email$|^(gmail|outlook)$/i;

export function channelOf(key: string): Channel {
  const k = key.trim().toLowerCase();
  if (!k || k === "(direct)") return "Direct";
  if (AI.test(k)) return "AI assistants";
  if (EMAIL.test(k)) return "Email";
  if (SEARCH.test(k)) return "Search";
  if (SOCIAL.test(k)) return "Social";
  return "Referral";
}

export function channels(items: { key: string; visitors: number }[]): { channel: Channel; visitors: number; top: string }[] {
  const by = new Map<Channel, { visitors: number; top: string; topV: number }>();
  for (const i of items) {
    if (i.key === "Others") continue;
    const c = channelOf(i.key);
    const e = by.get(c) ?? { visitors: 0, top: i.key, topV: -1 };
    e.visitors += i.visitors;
    if (i.visitors > e.topV) { e.top = i.key; e.topV = i.visitors; }
    by.set(c, e);
  }
  return [...by.entries()].map(([channel, e]) => ({ channel, visitors: e.visitors, top: e.top })).sort((a, b) => b.visitors - a.visitors);
}

/* ---------------- by the numbers ---------------- */

export type NumberStat = { label: string; value: string; foot: string };

/** Figures a 30-day dashboard can't give you, computed from every day kept. */
export function byTheNumbers(daily: MetricRow[], monthly: MonthRow[]): NumberStat[] {
  const today = daysAgo(0);
  const days = daily.filter((d) => d.date < today && d.visitors != null) as (MetricRow & { visitors: number })[];
  if (!days.length && !monthly.length) return [];
  const out: NumberStat[] = [];
  const lifetime = monthly.reduce((a, m) => a + (m.visitors ?? 0), 0);
  const lifePv = monthly.reduce((a, m) => a + (m.pageviews ?? 0), 0);
  out.push({ label: "Visitors kept, all time", value: n0(lifetime), foot: monthly.length ? `since ${monthLabel(monthly[0].month)}` : "" });
  if (lifePv) out.push({ label: "Page views kept", value: n0(lifePv), foot: lifetime ? `${(lifePv / lifetime).toFixed(2)} per visitor` : "" });
  if (days.length >= 7) {
    const vals = days.map((d) => d.visitors);
    out.push({ label: "Typical day", value: n0(median(vals)), foot: `median of ${n0(days.length)} days · average ${n0(vals.reduce((a, b) => a + b, 0) / vals.length)}` });
    const best = days.reduce((m, d) => (d.visitors > m.visitors ? d : m));
    out.push({ label: "Best day", value: n0(best.visitors), foot: `${longDay(best.date)}, ${best.date.slice(0, 4)}` });
    const quiet = days.filter((d) => d.visitors === 0).length;
    out.push({ label: "Days with traffic", value: `${Math.round(((days.length - quiet) / days.length) * 100)}%`, foot: quiet ? `${n0(quiet)} days with no visitors` : "every kept day had visitors" });
  }
  const fullMonths = monthly.filter((m) => m.month < today.slice(0, 7) && m.visitors != null && (m.granularity === "month" || m.days >= lmDays(m.month) - 1));
  if (fullMonths.length >= 2) {
    const best = fullMonths.reduce((a, b) => ((b.visitors ?? 0) > (a.visitors ?? 0) ? b : a));
    out.push({ label: "Best month", value: n0(best.visitors ?? 0), foot: monthFull(best.month) });
    const recent = fullMonths.slice(-7);
    const first = recent[0].visitors ?? 0, last = recent.at(-1)!.visitors ?? 0;
    if (recent.length >= 3 && first > 0 && last > 0) {
      const g = (Math.pow(last / first, 1 / (recent.length - 1)) - 1) * 100;
      out.push({ label: "Monthly growth", value: `${g >= 0 ? "+" : ""}${g.toFixed(1)}%`, foot: `compounded over the last ${recent.length - 1} full months` });
    }
  }
  const bounce = days.filter((d) => d.bounce_rate != null).slice(-30);
  if (bounce.length >= 7) out.push({ label: "Bounce rate, 30 days", value: `${(bounce.reduce((a, d) => a + d.bounce_rate!, 0) / bounce.length).toFixed(1)}%`, foot: "share of one-page visits" });
  return out;
}

/** Median visitors by weekday over the last 12 weeks (Mon first), or null if under 3 weeks. */
export function weekdayProfile(daily: MetricRow[]): { label: string; value: number }[] | null {
  const today = daysAgo(0);
  const days = daily.filter((d) => d.date < today && d.visitors != null).slice(-84);
  if (days.length < 21) return null;
  const by: number[][] = [[], [], [], [], [], [], []];
  days.forEach((d) => by[new Date(d.date + "T00:00:00Z").getUTCDay()].push(d.visitors!));
  return [1, 2, 3, 4, 5, 6, 0].map((i) => ({ label: WEEKDAYS[i].slice(0, 3), value: median(by[i]) }));
}

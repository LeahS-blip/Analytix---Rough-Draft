"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DashProps } from "./Dashboard";
import { useUi } from "./Dashboard";
import { CoverageGrid, LineChart, Sparkline } from "./charts";
import { fmt, monthFull, monthLabel } from "./client";
import { buildSeries, kpis, shiftMonth, type Range } from "./stats";

const RANGE_TEXT: Record<Range, string> = { "30d": "last 30 days", "6m": "last 6 months", "1y": "last 12 months", all: "all time" };

function EmptyState({ siteId }: { siteId: number }) {
  const { openAddSource } = useUi();
  return (
    <div className="card empty">
      <h3>Nothing kept yet</h3>
      <p>
        Connect Vercel to start daily snapshots (and backfill whatever Vercel still remembers), or drop in a CSV / JSON export
        to bring in your older history right now.
      </p>
      <div className="actions">
        <button className="btn primary" onClick={openAddSource}>Connect Vercel</button>
        <Link className="btn" href={`/app/${siteId}/import`}>Import a file</Link>
      </div>
    </div>
  );
}

function YoyToggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return (
    <button className="toggle-yoy" aria-pressed={on} onClick={() => set(!on)}>
      <span className="switch" /> Compare to last year
    </button>
  );
}

/* ---------------- overview ---------------- */

export function OverviewView({ site, daily, monthly, sources, range }: DashProps & { range: Range }) {
  const [yoy, setYoy] = useState(false);
  const series = useMemo(() => buildSeries(range, daily, monthly), [range, daily, monthly]);
  const { kpis: tiles, basis } = useMemo(() => kpis(daily, monthly), [daily, monthly]);
  const coverage = useMemo(() => new Map(daily.map((d) => [d.date, d.visitors])), [daily]);

  if (!monthly.length) return <EmptyState siteId={site.id} />;

  const windowVals = series.values.filter((v): v is number => v != null);
  const total = windowVals.reduce((a, b) => a + b, 0) + (series.partial?.value ?? 0);
  const bestIdx = series.values.reduce<number>((bi, v, i) => (v != null && (bi < 0 || v > (series.values[bi] ?? -1)) ? i : bi), -1);
  const prevTotal = series.prev.reduce<number>((a, v) => a + (v ?? 0), 0);
  const prevComparable = series.prev.every((p, i) => (series.values[i] == null) === (p == null)) && prevTotal > 0;
  const lineTotal = total - (series.partial?.value ?? 0);
  const yoyPct = prevComparable ? Math.round(((lineTotal - prevTotal) / prevTotal) * 100) : null;

  const covWeeks = 18;
  const covDays = covWeeks * 7;
  const covSince = new Date(Date.now() - covDays * 864e5).toISOString().slice(0, 10);
  const covCount = [...coverage.keys()].filter((d) => d > covSince).length;
  const firstDay = daily[0]?.date;
  const covDenominator = firstDay ? Math.min(covDays, Math.ceil((Date.now() - Date.parse(firstDay)) / 864e5) + 1) : covDays;

  return (
    <>
      <div className="kpis">
        {tiles.map((k) => {
          const good = k.delta == null ? null : k.goodWhenUp ? k.delta >= 0 : k.delta <= 0;
          return (
            <div className="kpi" key={k.label}>
              <div className="k-top">
                <span className="k-lbl">{k.label}</span>
                {k.delta != null && Number.isFinite(k.delta) && (
                  <span className={`k-delta ${good ? "up" : "down"}`}>
                    {k.delta >= 0 ? "▲" : "▼"} {Math.abs(k.delta).toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="k-val tnum">{k.value}</div>
              <Sparkline values={k.spark} />
              <div className="k-foot">{k.foot}</div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Visitors — full history kept</h3>
            <div className="sub">
              {series.granularity === "day" ? "Daily visitors, last 30 days" : `Monthly totals (${RANGE_TEXT[range]})`}
              {sources.length ? " · your provider only keeps a rolling window" : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
            <YoyToggle on={yoy} set={setYoy} />
            <div className="legend">
              <span><i className="lg-line" style={{ borderColor: "var(--accent)" }} /> This period</span>
              {yoy && <span><i className="lg-line" style={{ borderColor: "var(--ghost)", borderTopStyle: "dashed" }} /> Year before</span>}
            </div>
          </div>
        </div>
        <div className="maininfo">
          <span className="big tnum">{fmt(total)}</span>
          <span className="cmp">
            visitors kept, {RANGE_TEXT[range]}
            {yoyPct != null && (
              <> · <b className={yoyPct >= 0 ? "up" : ""}>{yoyPct >= 0 ? "▲" : "▼"} {Math.abs(yoyPct)}%</b> year over year</>
            )}
          </span>
          {bestIdx >= 0 && (
            <span className="cmp">
              best {series.granularity === "day" ? "day" : "month"} <b>{series.labels[bestIdx]}</b> · {fmt(series.values[bestIdx])}
            </span>
          )}
          {series.partial && (
            <span className="so-far" title="The current month isn't over, so it's left off the line">
              {series.partial.label} so far · <b>{fmt(series.partial.value)}</b> · {series.partial.days} day{series.partial.days === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {windowVals.length ? (
          <LineChart
            labels={series.labels}
            values={series.values}
            prev={yoy ? series.prev : undefined}
            edgeAt={sources.length ? series.edgeAt : null}
            label={`Visitors, ${RANGE_TEXT[range]}`}
          />
        ) : (
          <div className="chart-empty">No data in this range — try “All”.</div>
        )}
      </div>

      <div className="row2">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Snapshot coverage</h3>
              <div className="sub">Each square is a day · last {covWeeks} weeks</div>
            </div>
            <span className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>
              {daily.length ? `${Math.round((covCount / Math.max(1, covDenominator)) * 100)}% complete` : "no daily data"}
            </span>
          </div>
          <div className="cov">
            <CoverageGrid weeks={covWeeks} byDate={coverage} />
            <div className="cov-foot">
              <span>{covCount} of {Math.min(covDays, covDenominator)} days kept</span>
              <span className="cov-legend">
                <i style={{ background: "var(--ghost-wash)", border: "1px solid var(--line)" }} /> none{" "}
                <i style={{ background: "var(--accent)", opacity: 0.3 }} />
                <i style={{ background: "var(--accent)", opacity: 0.55 }} />
                <i style={{ background: "var(--accent)" }} /> busiest
              </span>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>At a glance</h3>
              <div className="sub">Computed from everything you&apos;ve kept · KPIs above use the {basis}</div>
            </div>
          </div>
          <Highlights monthly={monthly} />
        </div>
      </div>
    </>
  );
}

function Highlights({ monthly }: { monthly: DashProps["monthly"] }) {
  const withV = monthly.filter((m) => m.visitors != null);
  if (!withV.length) return <p className="muted small">No visitor numbers yet.</p>;
  const best = withV.reduce((a, b) => ((b.visitors ?? 0) > (a.visitors ?? 0) ? b : a));
  let jump: { m: string; pct: number } | null = null;
  for (let i = 1; i < withV.length; i++) {
    const a = withV[i - 1], b = withV[i];
    if (shiftMonth(a.month, 1) !== b.month || !a.visitors) continue;
    const pct = ((b.visitors! - a.visitors) / a.visitors) * 100;
    if (!jump || pct > jump.pct) jump = { m: b.month, pct };
  }
  const lifetime = withV.reduce((a, m) => a + (m.visitors ?? 0), 0);
  const items = [
    { t: `${fmt(lifetime)} lifetime visitors kept`, d: `${monthFull(withV[0].month)} → ${monthFull(withV.at(-1)!.month)}` },
    { t: `Best month: ${monthFull(best.month)}`, d: `${fmt(best.visitors)} visitors` },
    ...(jump && jump.pct > 0 ? [{ t: `Biggest jump: ${monthFull(jump.m)}`, d: `+${Math.round(jump.pct)}% over the month before` }] : []),
  ];
  return (
    <ol className="mstone">
      {items.map((i) => (
        <li key={i.t}>
          <span className="dot" />
          <div className="mt">{i.t}</div>
          <div className="md">{i.d}</div>
        </li>
      ))}
    </ol>
  );
}

/* ---------------- trends ---------------- */

export function TrendsView({ site, daily, monthly, range }: DashProps & { range: Range }) {
  const [yoy, setYoy] = useState(false);
  const series = useMemo(() => buildSeries(range, daily, monthly), [range, daily, monthly]);
  if (!monthly.length) return <EmptyState siteId={site.id} />;
  const byMonth = new Map(monthly.map((m) => [m.month, m.visitors]));
  const rows = monthly
    .filter((m) => byMonth.get(shiftMonth(m.month, -12)) != null && m.visitors != null)
    .map((m) => ({ month: m.month, cur: m.visitors!, prev: byMonth.get(shiftMonth(m.month, -12))! }))
    .reverse();

  return (
    <>
      <p className="view-intro">Your full kept history. Use the range control above to zoom, and toggle the prior-year overlay to compare like-for-like.</p>
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Visitors over time</h3>
            <div className="sub">{monthly.length} month{monthly.length === 1 ? "" : "s"} kept · showing {RANGE_TEXT[range]}</div>
          </div>
          <YoyToggle on={yoy} set={setYoy} />
        </div>
        <LineChart labels={series.labels} values={series.values} prev={yoy ? series.prev : undefined} height={320} label="Visitors trend" />
      </div>
      <div className="card">
        <div className="card-head">
          <div>
            <h3>This month vs. same month last year</h3>
            <div className="sub">Year-over-year change by month</div>
          </div>
        </div>
        {rows.length ? (
          <table>
            <thead>
              <tr><th>Month</th><th className="num">This year</th><th className="num">Last year</th><th className="num">Change</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const chg = Math.round(((r.cur - r.prev) / r.prev) * 100);
                return (
                  <tr key={r.month}>
                    <td>{monthLabel(r.month)}</td>
                    <td className="num">{fmt(r.cur)}</td>
                    <td className="num">{fmt(r.prev)}</td>
                    <td className={`num trend ${chg >= 0 ? "up" : "down"}`}>{chg >= 0 ? "▲ " : "▼ "}{Math.abs(chg)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="muted small">Year-over-year comparisons appear once you&apos;ve kept the same month in two different years.</p>
        )}
      </div>
    </>
  );
}

/* ---------------- history table ---------------- */

type SortKey = "month" | "visitors" | "pageviews" | "bounce_rate";

export function HistoryView({ site, monthly, daily }: DashProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "month", dir: -1 });
  if (!monthly.length) return <EmptyState siteId={site.id} />;
  const rows = [...monthly].sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    if (typeof x === "string" && typeof y === "string") return sort.dir * x.localeCompare(y);
    return sort.dir * (((x as number | null) ?? -Infinity) - ((y as number | null) ?? -Infinity));
  });
  const th = (key: SortKey, label: string, num = true) => (
    <th
      className={`sortable${num ? " num" : ""}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === "month" ? -1 : -1 }))}
      aria-sort={sort.key === key ? (sort.dir > 0 ? "ascending" : "descending") : "none"}
    >
      {label} <span className="arw">{sort.key === key ? (sort.dir > 0 ? "↑" : "↓") : "↕"}</span>
    </th>
  );
  return (
    <>
      <p className="view-intro">Every month you&apos;ve preserved, in one place. Click a column header to sort — then export the whole thing.</p>
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Monthly history</h3>
            <div className="sub">
              {monthly.length} months · {monthLabel(monthly[0].month)} – {monthLabel(monthly.at(-1)!.month)} · {daily.length} days of daily detail
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a className="btn sm" href={`/api/sites/${site.id}/export?granularity=month`}>Export monthly CSV</a>
            <a className="btn sm" href={`/api/sites/${site.id}/export?granularity=day`}>Export daily CSV</a>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                {th("month", "Month", false)}
                {th("visitors", "Visitors")}
                {th("pageviews", "Page views")}
                {th("bounce_rate", "Bounce")}
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}>
                  <td>{monthLabel(r.month)}</td>
                  <td className="num">{fmt(r.visitors)}</td>
                  <td className="num">{fmt(r.pageviews)}</td>
                  <td className="num">{r.bounce_rate == null ? "—" : r.bounce_rate.toFixed(1) + "%"}</td>
                  <td className="mono faint small">{r.granularity === "day" ? `${r.days} day${r.days === 1 ? "" : "s"}` : "monthly total"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

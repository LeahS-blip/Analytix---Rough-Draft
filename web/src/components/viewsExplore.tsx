"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExploreHistory, ExploreItem } from "@/lib/data";
import type { DashProps } from "./Dashboard";
import { LineChart, Sparkline } from "./charts";
import { api, dayLabel, fmt } from "./client";
import { prettyKey } from "./viewsData";

/** Every breakdown KeepStat keeps; pages are counted in views, everything else in visitors. */
export const EXPLORE_DIMS: { key: string; label: string; one: string; metric: "pageviews" | "visitors" }[] = [
  { key: "requestPath", label: "Pages", one: "page", metric: "pageviews" },
  { key: "referrerHostname", label: "Referrers", one: "referrer", metric: "visitors" },
  { key: "country", label: "Countries", one: "country", metric: "visitors" },
  { key: "deviceType", label: "Devices", one: "device", metric: "visitors" },
  { key: "browser", label: "Browsers", one: "browser", metric: "visitors" },
  { key: "os", label: "Operating systems", one: "OS", metric: "visitors" },
  { key: "utmSource", label: "Campaign sources", one: "UTM source", metric: "visitors" },
  { key: "utmCampaign", label: "Campaigns", one: "campaign", metric: "visitors" },
];

type SortKey = "all" | "recent" | "change" | "first";
const longDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const isoDay = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

export function ExploreView({ site }: DashProps) {
  const [dims, setDims] = useState<{ dimension: string; items: number; from: string; to: string }[] | null>(null);
  const [dim, setDim] = useState("requestPath");
  const [items, setItems] = useState<ExploreItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ dims: NonNullable<typeof dims> }>(`/api/sites/${site.id}/explore`, "GET").then((r) => {
      if ("error" in r) return setError(r.error);
      setDims(r.dims);
      // start on the first breakdown that has anything in it
      const first = EXPLORE_DIMS.find((d) => r.dims.some((x) => x.dimension === d.key));
      if (first) setDim(first.key);
    });
  }, [site.id]);

  useEffect(() => {
    setItems(null);
    setOpen(null);
    api<{ items: ExploreItem[] }>(`/api/sites/${site.id}/explore?dim=${dim}`, "GET").then((r) => {
      if ("error" in r) return setError(r.error);
      setItems(r.items);
    });
  }, [site.id, dim]);

  const info = EXPLORE_DIMS.find((d) => d.key === dim)!;
  const m = info.metric;
  const val = (i: ExploreItem, w: "all" | "recent" | "prior") =>
    m === "pageviews" ? (w === "all" ? i.pageviews : w === "recent" ? i.pv30 : i.pvPrior) : w === "all" ? i.visitors : w === "recent" ? i.v30 : i.vPrior;
  const change = (i: ExploreItem) => (val(i, "prior") >= 5 ? (val(i, "recent") - val(i, "prior")) / val(i, "prior") : null);

  const shown = useMemo(() => {
    if (!items) return [];
    const ql = query.trim().toLowerCase();
    const list = items.filter((i) => !ql || i.key.toLowerCase().includes(ql) || prettyKey(dim, i.key).toLowerCase().includes(ql));
    const by: Record<SortKey, (a: ExploreItem, b: ExploreItem) => number> = {
      all: (a, b) => val(b, "all") - val(a, "all"),
      recent: (a, b) => val(b, "recent") - val(a, "recent"),
      change: (a, b) => (change(b) ?? -Infinity) - (change(a) ?? -Infinity),
      first: (a, b) => b.first.localeCompare(a.first),
    };
    return list.sort(by[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query, sort, dim]);

  const total = items?.reduce((s, i) => s + val(i, "all"), 0) ?? 0;
  const hasAny = dims && dims.length > 0;

  if (dims && !hasAny)
    return (
      <div className="card empty">
        <h3>Nothing to explore yet</h3>
        <p>
          Explore shows the full history of every page, referrer, country, device, browser and campaign KeepStat has kept. Connect a source (or press{" "}
          <b>Fetch now</b> on Sources) and these start filling in with the next snapshot.
        </p>
      </div>
    );

  return (
    <>
      <p className="view-intro">
        Every {info.one} KeepStat has kept, not just your provider&apos;s window. Pick one to see its history day by day.
      </p>
      {error && <div className="err" role="alert">{error}</div>}
      <div className="card">
        <div className="ex-tabs" role="tablist" aria-label="Breakdown">
          {EXPLORE_DIMS.map((d) => {
            const n = dims?.find((x) => x.dimension === d.key)?.items ?? 0;
            return (
              <button key={d.key} role="tab" aria-selected={dim === d.key} disabled={!!dims && !n} onClick={() => { setDim(d.key); setQuery(""); }}>
                {d.label} {dims && <span className="ex-n">{n}</span>}
              </button>
            );
          })}
        </div>

        {open && <ItemDetail siteId={site.id} dim={dim} itemKey={open} metric={m} item={items?.find((i) => i.key === open) ?? null} onClose={() => setOpen(null)} />}

        <div className="ex-bar">
          <input className="input" type="search" placeholder={`Search ${info.label.toLowerCase()}…`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`Search ${info.label}`} />
          <a className="btn sm" href={`/api/sites/${site.id}/export?granularity=breakdowns`}>Export all breakdowns (CSV)</a>
        </div>

        {!items ? (
          <div className="ex-loading"><span className="sk" style={{ height: 14, width: "60%" }} /><span className="sk" style={{ height: 14, width: "45%" }} /><span className="sk" style={{ height: 14, width: "52%" }} /></div>
        ) : !shown.length ? (
          <p className="muted small">{query ? "Nothing matches that search." : "Nothing kept for this breakdown yet."}</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="ex-table">
              <thead>
                <tr>
                  <th>{info.one.charAt(0).toUpperCase() + info.one.slice(1)}</th>
                  {([["all", `All kept (${m === "pageviews" ? "views" : "visitors"})`], ["recent", "Last 30 days"], ["change", "vs 30 before"], ["first", "First seen"]] as [SortKey, string][]).map(([k, label]) => (
                    <th key={k} className={`sortable${k === "first" ? "" : " num"}`} aria-sort={sort === k ? "descending" : "none"} onClick={() => setSort(k)}>
                      {label} <span className="arw">{sort === k ? "↓" : "↕"}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 200).map((i) => {
                  const c = change(i);
                  const isNew = i.first >= isoDay(-30) && dims!.find((x) => x.dimension === dim)!.from < isoDay(-45);
                  return (
                    <tr key={i.key} className={open === i.key ? "sel" : ""} onClick={() => setOpen(open === i.key ? null : i.key)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(open === i.key ? null : i.key)}>
                      <td className="ex-key" title={i.key}>
                        <span className="ex-bg" style={{ width: `${total ? Math.max(1, (val(i, "all") / val(shown[0], "all")) * 100) : 0}%` }} />
                        <span className="ex-name">{prettyKey(dim, i.key)}</span>
                        {isNew && <span className="ex-new">new</span>}
                      </td>
                      <td className="num">{fmt(val(i, "all"))}</td>
                      <td className="num">{fmt(val(i, "recent"))}</td>
                      <td className={`num trend ${c == null ? "" : c >= 0 ? "up" : "down"}`}>{c == null ? "—" : `${c >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(c * 100))}%`}</td>
                      <td className="mono small">{longDate(i.first)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length > 200 && <p className="muted small" style={{ marginTop: 8 }}>Showing the top 200 of {fmt(shown.length)}. Search to find the rest, or export the CSV.</p>}
          </div>
        )}
      </div>
    </>
  );
}

function ItemDetail({ siteId, dim, itemKey, metric, item, onClose }: { siteId: number; dim: string; itemKey: string; metric: "pageviews" | "visitors"; item: ExploreItem | null; onClose: () => void }) {
  const [h, setH] = useState<ExploreHistory | null>(null);
  useEffect(() => {
    setH(null);
    api<ExploreHistory>(`/api/sites/${siteId}/explore?dim=${dim}&key=${encodeURIComponent(itemKey)}`, "GET").then((r) => !("error" in r) && setH(r));
  }, [siteId, dim, itemKey]);

  const series = useMemo(() => {
    if (!h || !h.coveredFrom) return null;
    const by = new Map(h.days.map((d) => [d.date, metric === "pageviews" ? d.pageviews : d.visitors]));
    const keys: string[] = [];
    for (let t = Date.parse(h.coveredFrom), end = Date.parse(isoDay(-1)); t <= end; t += 864e5) keys.push(new Date(t).toISOString().slice(0, 10));
    return { keys, labels: keys.map(dayLabel), values: keys.map((k) => by.get(k) ?? null) };
  }, [h, metric]);

  const unit = metric === "pageviews" ? "views" : "visitors";
  const best = h?.days.reduce<{ date: string; v: number } | null>((b, d) => {
    const v = (metric === "pageviews" ? d.pageviews : d.visitors) ?? 0;
    return !b || v > b.v ? { date: d.date, v } : b;
  }, null);
  const avgShare = h && h.days.filter((d) => d.share != null).length ? h.days.reduce((s, d) => s + (d.share ?? 0), 0) / h.days.filter((d) => d.share != null).length : null;
  const spark = series?.values.slice(-30).map((v) => v ?? 0) ?? [];

  return (
    <div className="ex-detail">
      <div className="card-head">
        <div>
          <h3 className="ex-title">{prettyKey(dim, itemKey)}</h3>
          {prettyKey(dim, itemKey) !== itemKey && <div className="sub mono">{itemKey}</div>}
        </div>
        <button className="btn sm ghost" onClick={onClose}>Close</button>
      </div>
      <div className="nums ex-nums">
        <div className="num-cell"><div className="nl">All kept</div><div className="nv">{fmt(item ? (metric === "pageviews" ? item.pageviews : item.visitors) : null)}</div><div className="nf">{unit} since {item ? longDate(item.first) : "…"}</div></div>
        <div className="num-cell"><div className="nl">Last 30 days</div><div className="nv">{fmt(item ? (metric === "pageviews" ? item.pv30 : item.v30) : null)}</div><div className="nf"><Sparkline values={spark} /></div></div>
        <div className="num-cell"><div className="nl">Best day</div><div className="nv">{best ? fmt(best.v) : "—"}</div><div className="nf">{best ? longDate(best.date) : "no daily data yet"}</div></div>
        <div className="num-cell"><div className="nl">Typical share</div><div className="nv">{avgShare == null ? "—" : `${Math.round(avgShare * 100)}%`}</div><div className="nf">of the day&apos;s {metric === "pageviews" ? "page views" : "visitors"} · in the top list {h?.days.length ?? 0} days</div></div>
      </div>
      {!h ? (
        <div className="chart-empty">Loading history…</div>
      ) : series && series.values.some((v) => v != null) ? (
        <LineChart labels={series.labels} values={series.values} height={220} label={`${prettyKey(dim, itemKey)}, daily ${unit}`} unit={unit} />
      ) : (
        <p className="muted small" style={{ margin: "4px 0 0" }}>No day-by-day chart yet: it builds up with each daily snapshot from here on.</p>
      )}
      {h && h.blocks.length > 0 && (
        <p className="muted small" style={{ marginTop: 8 }}>
          Also kept as {h.blocks.length === 1 ? "a block" : "blocks"} before daily detail started:{" "}
          {h.blocks.map((b) => `${fmt(metric === "pageviews" ? b.pageviews : b.visitors)} ${unit} (${longDate(b.from)} – ${longDate(b.to)})`).join("; ")}.
        </p>
      )}
      {series && series.values.some((v) => v != null) && <p className="faint small" style={{ marginTop: 4 }}>Gaps are days it wasn&apos;t in that day&apos;s top list.</p>}
    </div>
  );
}

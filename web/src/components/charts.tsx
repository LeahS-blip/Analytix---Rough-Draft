"use client";

import { useId, useRef, useState } from "react";

/** Axis ticks at "nice" steps (1, 2, 2.5, 5 × 10^n), 4–5 intervals. */
export function niceTicks(dataMax: number): number[] {
  if (dataMax <= 0) return [0, 5, 10];
  const rough = dataMax / 4;
  const p = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= rough)!;
  const top = Math.ceil(dataMax / step) * step;
  const out: number[] = [];
  for (let t = 0; t <= top + step / 2; t += step) out.push(+t.toFixed(6));
  return out;
}

export function short(n: number) {
  if (n >= 1e6) return +(n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return +(n / 1e3).toFixed(1) + "k";
  return String(Math.round(n));
}

const fmtN = (v: number) => Math.round(v).toLocaleString("en-US");

/**
 * Line chart in the prototype's style: accent line with a soft fill,
 * optional dashed prior-period overlay, "provider's edge" marker, and a hover readout.
 */
export function LineChart({
  labels,
  values,
  prev,
  edgeAt,
  width = 960,
  height = 300,
  label,
  unit = "visitors",
}: {
  labels: string[];
  values: (number | null)[];
  prev?: (number | null)[];
  edgeAt?: number | null; // fractional index where the provider's 30-day window begins
  width?: number;
  height?: number;
  label: string;
  unit?: string;
}) {
  const gid = "g" + useId().replace(/[^a-z0-9]/gi, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const padL = 48, padR = 18, padT = 22, padB = 34;
  const iw = width - padL - padR, ih = height - padT - padB;
  const all = [...values, ...(prev ?? [])].filter((v): v is number => v != null);
  const ticks = niceTicks(Math.max(0, ...all));
  const max = ticks.at(-1)!;
  const n = values.length;
  const x = (i: number) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => padT + (1 - v / max) * ih;
  // Label spacing anchored to the newest point so the last label is always shown.
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 78))));

  const path = (arr: (number | null)[]) => {
    let d = "";
    let pen = false;
    arr.forEach((v, i) => {
      if (v == null) return void (pen = false);
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };
  const firstIdx = values.findIndex((v) => v != null);
  let lastIdx = -1;
  values.forEach((v, i) => v != null && (lastIdx = i));
  const line = path(values);
  const contiguous = firstIdx >= 0 && values.slice(firstIdx, lastIdx + 1).every((v) => v != null);
  const area = contiguous && lastIdx > firstIdx ? `${line} L${x(lastIdx)} ${padT + ih} L${x(firstIdx)} ${padT + ih} Z` : null;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    const i = Math.round(((px - padL) / iw) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  }

  const hv = hover != null ? values[hover] : null;
  const hp = hover != null && prev ? prev[hover] : null;
  const tipW = prev ? 168 : 132;
  const tipX = hover != null ? Math.min(Math.max(x(hover) - tipW / 2, padL), width - padR - tipW) : 0;

  return (
    <svg
      ref={svgRef}
      className="chart"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={label}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.24} />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} y1={y(t)} x2={width - padR} y2={y(t)} stroke="var(--line)" strokeWidth={1} strokeDasharray={t === 0 ? undefined : "2 4"} />
          <text x={padL - 10} y={y(t) + 4} textAnchor="end" className="ax">{t === 0 ? "0" : short(t)}</text>
        </g>
      ))}
      {labels.map((m, i) =>
        (n - 1 - i) % every === 0 ? (
          <text key={i} x={x(i)} y={height - 10} textAnchor={i === n - 1 && n > 1 ? "end" : i === 0 ? "start" : "middle"} className="ax">
            {m}
          </text>
        ) : null
      )}
      {prev && <path d={path(prev)} fill="none" stroke="var(--ghost)" strokeWidth={2} strokeDasharray="3 4" strokeLinecap="round" strokeLinejoin="round" />}
      {area && <path d={area} fill={`url(#${gid})`} />}
      {edgeAt != null && edgeAt > 0 && edgeAt < n - 1 && (
        <g>
          <line x1={x(edgeAt)} y1={padT - 8} x2={x(edgeAt)} y2={padT + ih} stroke="var(--accent-deep)" strokeWidth={1.2} strokeDasharray="4 4" opacity={0.55} />
          <text x={x(edgeAt) - 6} y={padT - 1} textAnchor="end" className="ax edge">provider&apos;s 30-day edge</text>
        </g>
      )}
      <path d={line} className="chart-line" fill="none" stroke="var(--accent)" strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round" />
      {lastIdx >= 0 && hover == null && (
        <circle cx={x(lastIdx)} cy={y(values[lastIdx]!)} r={4.5} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2.4} />
      )}

      {hover != null && (
        <g pointerEvents="none">
          <line x1={x(hover)} y1={padT} x2={x(hover)} y2={padT + ih} stroke="var(--line-strong)" strokeWidth={1} />
          {hp != null && <circle cx={x(hover)} cy={y(hp)} r={3.5} fill="var(--surface)" stroke="var(--ghost)" strokeWidth={2} />}
          {hv != null && <circle cx={x(hover)} cy={y(hv)} r={5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2.5} />}
          <g transform={`translate(${tipX} ${padT - 18})`}>
            <rect width={tipW} height={prev ? 52 : 38} rx={8} className="tip-bg" />
            <text x={10} y={15} className="tip-k">{labels[hover]}</text>
            <text x={10} y={31} className="tip-v">{hv == null ? "no data" : `${fmtN(hv)} ${unit}`}</text>
            {prev && <text x={10} y={45} className="tip-k">{hp == null ? "year before: —" : `year before: ${fmtN(hp)}`}</text>}
          </g>
        </g>
      )}
    </svg>
  );
}

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="k-spark" viewBox="0 0 120 34" aria-hidden="true" />;
  // Floor the scale at 75% of the max so a ±3% wobble doesn't look like a cliff.
  const mx = Math.max(...values), mn = Math.min(Math.min(...values), mx * 0.75);
  const sx = (i: number) => (i / (values.length - 1)) * 120;
  const sy = (v: number) => 31 - ((v - mn) / (mx - mn || 1)) * 26;
  const d = values.map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(" ");
  return (
    <svg className="k-spark" viewBox="0 0 120 34" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d} L120 34 L0 34 Z`} fill="var(--accent)" fillOpacity={0.1} />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Calendar-style coverage: one column per week, one square per day (Mon→Sun),
 * shaded by visitors; empty squares are days with no data.
 */
export function CoverageGrid({ weeks, byDate }: { weeks: number; byDate: Map<string, number | null> }) {
  const today = new Date();
  const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dow = (new Date(t0).getUTCDay() + 6) % 7; // Monday = 0
  const start = t0 - (dow + (weeks - 1) * 7) * 864e5;
  const cells: { date: string; v: number | null | undefined; future: boolean }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const t = start + i * 864e5;
    const date = new Date(t).toISOString().slice(0, 10);
    cells.push({ date, v: byDate.has(date) ? byDate.get(date) : undefined, future: t > t0 });
  }
  const present = cells.filter((c) => c.v !== undefined).map((c) => c.v ?? 0);
  const max = Math.max(1, ...present);
  return (
    <div className="cal" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`, maxWidth: weeks * 21 }} aria-hidden="true">
      {cells.map((c) => {
        if (c.future) return <div key={c.date} className="cell future" />;
        let cls = "cell miss";
        if (c.v !== undefined) {
          const r = (c.v ?? 0) / max;
          cls = r < 0.3 ? "cell l1" : r < 0.6 ? "cell l2" : "cell";
        }
        return <div key={c.date} className={cls} title={c.v === undefined ? `${c.date} · no data` : `${c.date} · ${fmtN(c.v ?? 0)} visitors`} />;
      })}
    </div>
  );
}

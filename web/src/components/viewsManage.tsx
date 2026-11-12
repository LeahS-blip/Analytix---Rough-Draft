"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ParseResult } from "@/lib/parseImport";
import type { DashProps } from "./Dashboard";
import { applyTheme, Modal, useUi } from "./Dashboard";
import { CoverageGrid } from "./charts";
import { ago, api, dayLabel, fmt, monthLabel, postJson, stamp } from "./client";
import { TIMEZONES } from "./NewSiteForm";

/* ---------------- snapshots ---------------- */

export function SnapshotsView({ site, daily, snapshots, sources }: DashProps) {
  const { toast, refresh, openAddSource } = useUi();
  const [busy, setBusy] = useState(false);
  const coverage = useMemo(() => new Map(daily.map((d) => [d.date, d.visitors])), [daily]);
  const live = sources.filter((s) => s.active);

  async function captureNow() {
    if (!live.length) return openAddSource();
    setBusy(true);
    let ok = 0;
    const errs: string[] = [];
    for (const s of live) {
      const r = await postJson<{ rows: number }>(`/api/sources/${s.id}/run`);
      if ("error" in r) errs.push(`${s.label}: ${r.error}`);
      else ok++;
    }
    setBusy(false);
    toast(errs.length ? `Snapshot failed: ${errs[0]}` : `Snapshot captured from ${ok} source${ok === 1 ? "" : "s"}`, errs.length ? "error" : "ok");
    refresh();
  }

  return (
    <>
      <p className="view-intro">
        KeepStat saves a dated snapshot of your numbers every day, so your history stays even after your provider stops showing it.
        Every import is logged here too, with the original file kept as the receipt.
      </p>
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Daily coverage</h3>
            <div className="sub">Last 26 weeks · {site.name}</div>
          </div>
          <span className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>{fmt(daily.length)} days kept</span>
        </div>
        <div className="cov">
          <CoverageGrid weeks={26} byDate={coverage} />
          <div className="cov-foot">
            <span>
              {live.length
                ? site.auto_snapshot
                  ? `Auto-snapshot on · checked hourly, captured once a day`
                  : "Auto-snapshot is off in Settings"
                : "No live source — connect one for automatic daily snapshots"}
            </span>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Snapshot &amp; import log</h3>
            <div className="sub">Most recent first</div>
          </div>
          <button className="btn sm" onClick={captureNow} disabled={busy}>
            {busy ? <span className="spin" /> : null} {live.length ? "Capture now" : "Connect a source"}
          </button>
        </div>
        {snapshots.length ? (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr><th>When</th><th>Source</th><th>Range</th><th className="num">Rows</th><th className="num">Visitors</th><th>Status</th></tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.id}>
                    <td className="mono" style={{ fontSize: 12 }}>{stamp(s.created_at)}</td>
                    <td className="wrap">{s.kind === "vercel" ? s.label : `${s.kind.toUpperCase()} · ${s.label}`}</td>
                    <td className="mono small">{s.range_from ? `${s.range_from} → ${s.range_to}` : "—"}</td>
                    <td className="num">{fmt(s.rows)}</td>
                    <td className="num">{fmt(s.visitors)}</td>
                    <td>
                      {s.status === "ok" ? <span className="st ok">✓ stored</span> : <span className="st bad" title={s.error ?? ""}>✕ {s.error?.slice(0, 60) ?? "failed"}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">No snapshots yet.</p>
        )}
      </div>
    </>
  );
}

/* ---------------- import ---------------- */

export function ImportView({ site }: DashProps) {
  const { toast, refresh, openAddSource } = useUi();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(f: File) {
    setError(null);
    setPreview(null);
    if (f.size > 5 * 1024 * 1024) return setError("That file is larger than 5 MB.");
    setBusy(true);
    const text = await f.text();
    setFile({ name: f.name, text });
    const r = await postJson<ParseResult>(`/api/sites/${site.id}/import`, { text, filename: f.name });
    setBusy(false);
    if ("error" in r) setError(r.error);
    else setPreview(r);
  }

  async function save() {
    if (!file) return;
    setBusy(true);
    const r = await postJson<{ saved: number }>(`/api/sites/${site.id}/import`, { text: file.text, filename: file.name, confirm: true });
    setBusy(false);
    if ("error" in r) return setError(r.error);
    toast(`Imported ${fmt(r.saved)} rows into your history`);
    setPreview(null);
    setFile(null);
    refresh();
    router.push(`/app/${site.id}/overview`);
  }

  const days = preview?.rows.filter((r) => r.granularity === "day").length ?? 0;
  const months = preview?.rows.filter((r) => r.granularity === "month").length ?? 0;

  return (
    <>
      <p className="view-intro">Connect a source once and it fetches daily; or bring a file for a one-time backfill of your older history.</p>
      <div className="imp-grid">
        <div className="imp">
          <div className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12h6M12 9v6" /><rect x="3" y="4" width="18" height="16" rx="3" /></svg></div>
          <h3>Connect a source</h3>
          <p>Link Vercel Web Analytics. KeepStat backfills what Vercel still has, then fetches a snapshot every day.</p>
          <button className="btn primary" onClick={openAddSource}>Connect Vercel</button>
        </div>
        <div className="imp">
          <div className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M8 7l4-4 4 4" /><path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" /></svg></div>
          <h3>Upload CSV / JSON</h3>
          <p>Daily or monthly rows. KeepStat finds the date, visitors, page-view and bounce columns for you.</p>
          <div
            className={`dropzone${drag ? " drag" : ""}${busy ? " busy" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files?.[0];
              if (f) load(f);
            }}
          >
            {busy ? "Reading…" : file ? `✓ ${file.name}` : "Click or drop a .csv / .json file"}
          </div>
          <input
            ref={input}
            type="file"
            accept=".csv,.json,.tsv,.txt,text/csv,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) load(f);
              e.target.value = "";
            }}
          />
        </div>
        <div className="imp soon">
          <div className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.6" /><path d="M21 16l-5-5-4 4-2-2-4 4" /></svg></div>
          <h3>Screenshot import <span className="soon-tag">soon</span></h3>
          <p>Drop a screenshot of any dashboard and AI reads the numbers into rows. Coming in the next release.</p>
        </div>
      </div>

      {error && <div className="err" role="alert">{error}</div>}

      {preview && file && (
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Mapped from {file.name}</h3>
              <div className="sub">
                {fmt(preview.rows.length)} rows · {preview.rows[0].date} → {preview.rows.at(-1)!.date} · check the numbers, then save
              </div>
            </div>
          </div>
          <div className="preview-meta">
            <span className="pchip">date ← <b>{preview.columns.date}</b></span>
            {preview.columns.visitors && <span className="pchip">visitors ← <b>{preview.columns.visitors}</b></span>}
            {preview.columns.pageviews && <span className="pchip">page views ← <b>{preview.columns.pageviews}</b></span>}
            {preview.columns.bounce_rate && <span className="pchip">bounce ← <b>{preview.columns.bounce_rate}</b></span>}
            {days > 0 && <span className="pchip">{fmt(days)} daily rows</span>}
            {months > 0 && <span className="pchip">{fmt(months)} monthly rows</span>}
            {preview.merged > 0 && <span className="pchip">{preview.merged} duplicate dates summed</span>}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr><th>Date</th><th className="num">Visitors</th><th className="num">Page views</th><th className="num">Bounce</th></tr>
              </thead>
              <tbody>
                {previewRows(preview).map((r, i) =>
                  r ? (
                    <tr key={r.date + r.granularity}>
                      <td className="mono" style={{ fontSize: 12 }}>{r.granularity === "month" ? monthLabel(r.date.slice(0, 7)) : `${dayLabel(r.date)}, ${r.date.slice(0, 4)}`}</td>
                      <td className="num">{fmt(r.visitors)}</td>
                      <td className="num">{fmt(r.pageviews)}</td>
                      <td className="num">{r.bounce_rate == null ? "—" : r.bounce_rate + "%"}</td>
                    </tr>
                  ) : (
                    <tr key={"gap" + i}><td className="faint">…</td><td className="num faint">…</td><td className="num faint">…</td><td className="num faint">…</td></tr>
                  )
                )}
              </tbody>
            </table>
          </div>
          {preview.skipped.length > 0 && (
            <div className="skipped">
              Skipped {preview.skipped.length} row{preview.skipped.length === 1 ? "" : "s"}:{" "}
              {preview.skipped.slice(0, 3).map((s) => `line ${s.line} (${s.reason})`).join("; ")}
              {preview.skipped.length > 3 ? "…" : ""}
            </div>
          )}
          <p className="muted small" style={{ marginTop: 12 }}>
            Rows for dates you already have are updated with these numbers. The original file is kept in your snapshot log.
          </p>
          <div className="modal-actions" style={{ marginTop: 14 }}>
            <button className="btn ghost" onClick={() => { setPreview(null); setFile(null); }}>Discard</button>
            <button className="btn primary" onClick={save} disabled={busy}>{busy ? <span className="spin" /> : null} Confirm &amp; save</button>
          </div>
        </div>
      )}
    </>
  );
}

function previewRows(p: ParseResult) {
  const r = p.rows;
  if (r.length <= 8) return r;
  return [...r.slice(0, 4), null, ...r.slice(-4)];
}

/* ---------------- sources ---------------- */

export function SourcesView({ sources }: DashProps) {
  const { toast, refresh, openAddSource, openModal, closeModal } = useUi();
  const [busyId, setBusyId] = useState<number | null>(null);

  async function run(id: number) {
    setBusyId(id);
    const r = await postJson<{ rows: number }>(`/api/sources/${id}/run`);
    setBusyId(null);
    toast("error" in r ? `Snapshot failed: ${r.error}` : `Snapshot stored · ${r.rows} days updated`, "error" in r ? "error" : "ok");
    refresh();
  }
  async function toggle(id: number, active: boolean) {
    const r = await api(`/api/sources/${id}`, "PATCH", { active });
    toast("error" in r ? r.error : active ? "Daily snapshots resumed" : "Daily snapshots paused", "error" in r ? "error" : "ok");
    refresh();
  }
  function remove(id: number, label: string) {
    openModal(
      <Modal title={`Disconnect ${label}?`} desc="KeepStat stops fetching from it. Everything it already saved stays in your history.">
        <div className="modal-actions">
          <button className="btn" onClick={closeModal}>Cancel</button>
          <button
            className="btn danger"
            onClick={async () => {
              const r = await api(`/api/sources/${id}`, "DELETE");
              closeModal();
              toast("error" in r ? r.error : "Source disconnected", "error" in r ? "error" : "ok");
              refresh();
            }}
          >
            Disconnect
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <>
      <p className="view-intro">The sources feeding this site&apos;s history. Each one keeps its own daily snapshot.</p>
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Connected sources</h3>
            <div className="sub">{sources.length} connected</div>
          </div>
          <button className="btn primary sm" onClick={openAddSource}>+ Add source</button>
        </div>
        {sources.length ? (
          <div className="conn-list">
            {sources.map((s) => {
              const failing = !!s.last_error;
              return (
                <div className="conn" key={s.id}>
                  <span className="cd" style={{ background: "#111317" }} />
                  <div className="info">
                    <div className="n">{s.label}</div>
                    <div className="s">last fetched {ago(s.last_success_at)} · added {stamp(s.created_at)}</div>
                    {failing && <div className="e">{s.last_error}</div>}
                  </div>
                  <span className={`status ${!s.active ? "off" : failing ? "err" : "on"}`}>{!s.active ? "paused" : failing ? "● error" : "● live"}</span>
                  <div className="actions">
                    <button className="btn sm ghost" onClick={() => run(s.id)} disabled={busyId === s.id}>
                      {busyId === s.id ? <span className="spin" /> : "Fetch now"}
                    </button>
                    <button className="btn sm ghost" onClick={() => toggle(s.id, !s.active)}>{s.active ? "Pause" : "Resume"}</button>
                    <button className="btn sm ghost danger" onClick={() => remove(s.id, s.label)}>Disconnect</button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="src-empty">
            <div className="src-empty-ic">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7" /></svg>
            </div>
            <div>
              <h4>No live source yet</h4>
              <p>Connect Vercel and KeepStat backfills whatever your Vercel plan still shows, then saves a snapshot every day, so nothing drops out of view.</p>
              <div className="src-chips">
                <button className="btn primary sm" onClick={openAddSource}>Connect Vercel</button>
                {["Google Analytics", "Cloudflare", "Plausible", "Umami"].map((n) => (
                  <span key={n} className="pchip faint">{n} · soon</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

type Project = { projectId: string; name: string; teamId: string | null; teamName: string };

export function AddSourceModal({ siteId }: { siteId: number }) {
  const { toast, refresh, closeModal } = useUi();
  const router = useRouter();
  const [step, setStep] = useState<"pick" | "vercel">("pick");
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [chosen, setChosen] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const OTHERS = [
    { n: "Google Analytics", c: "#F6821F" },
    { n: "Cloudflare", c: "#F38020" },
    { n: "Plausible", c: "#5850EC" },
    { n: "Umami", c: "#2B9348" },
    { n: "Stripe", c: "#635BFF" },
  ];

  async function findProjects(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await postJson<{ projects: Project[] }>("/api/vercel/projects", { token });
    setBusy(false);
    if ("error" in r) return setError(r.error);
    setProjects(r.projects);
    if (r.projects.length === 1) setChosen(r.projects[0]);
  }

  async function connect() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    const r = await postJson<{ id: number; first: { ok: boolean; rows: number; error?: string } }>(`/api/sites/${siteId}/sources`, {
      kind: "vercel",
      token,
      projectId: chosen.projectId,
      projectName: chosen.name,
      teamId: chosen.teamId,
    });
    setBusy(false);
    if ("error" in r) return setError(r.error);
    closeModal();
    toast(r.first.ok ? `Vercel connected · backfilled ${r.first.rows} days` : `Connected, but the first fetch failed: ${r.first.error}`, r.first.ok ? "ok" : "error");
    refresh();
    router.push(`/app/${siteId}/sources`);
  }

  if (step === "pick")
    return (
      <Modal title="Add a source" desc="Pick a platform to connect. KeepStat fetches a daily snapshot automatically.">
        <div className="source-grid">
          <button className="source-opt" onClick={() => setStep("vercel")}>
            <span className="cd" style={{ background: "#111317" }} />
            <span><span className="n">Vercel</span><br /><span className="s">Web Analytics</span></span>
          </button>
          {OTHERS.map((o) => (
            <button className="source-opt" key={o.n} disabled>
              <span className="cd" style={{ background: o.c }} />
              <span><span className="n">{o.n}</span><br /><span className="s">coming soon</span></span>
            </button>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 14 }}>Using something else today? Export a CSV from it and use Import.</p>
      </Modal>
    );

  return (
    <Modal title="Connect Vercel" desc="KeepStat reads daily visitors and page views from Vercel Web Analytics.">
      <ol className="steps-mini">
        <li>Make sure Web Analytics is enabled on the project.</li>
        <li>
          Create a token at{" "}
          <a href="https://vercel.com/account/settings/tokens" target="_blank" rel="noreferrer">vercel.com/account/settings/tokens</a>{" "}
          with access to that project&apos;s team.
        </li>
        <li>Paste it below — it&apos;s encrypted before it&apos;s stored.</li>
      </ol>
      {error && <div className="err" role="alert">{error}</div>}
      <form onSubmit={findProjects} className="field">
        <label htmlFor="vtoken">Access token</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input id="vtoken" type="password" autoComplete="off" className="input" value={token} onChange={(e) => { setToken(e.target.value); setProjects(null); setChosen(null); }} autoFocus />
          <button className="btn" type="submit" disabled={busy || !token.trim()}>{busy && !projects ? <span className="spin" /> : "Find projects"}</button>
        </div>
      </form>
      {projects && (
        <div className="field">
          <label>Project</label>
          <div className="proj-list">
            {projects.map((p) => (
              <button key={p.projectId} type="button" className="proj" aria-pressed={chosen?.projectId === p.projectId} onClick={() => setChosen(p)}>
                <span className="pn">{p.name}</span>
                <span className="pt">{p.teamName}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={() => setStep("pick")}>Back</button>
        <button className="btn primary" onClick={connect} disabled={!chosen || busy}>
          {busy && projects ? <><span className="spin" /> Backfilling…</> : "Connect & backfill"}
        </button>
      </div>
    </Modal>
  );
}

/* ---------------- settings ---------------- */

export function SettingsView({ site }: DashProps) {
  const { toast, refresh, openModal, closeModal } = useUi();
  const router = useRouter();
  const [name, setName] = useState(site.name);
  const [tz, setTz] = useState(site.timezone);
  const [snap, setSnap] = useState(!!site.auto_snapshot);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  useEffect(() => {
    const t = document.documentElement.getAttribute("data-theme");
    setTheme(t === "light" || t === "dark" ? t : "system");
  }, []);
  const zones = TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES];

  async function save() {
    const r = await api(`/api/sites/${site.id}`, "PATCH", { name, timezone: tz, auto_snapshot: snap });
    toast("error" in r ? r.error : "Settings saved", "error" in r ? "error" : "ok");
    refresh();
  }
  function confirmDelete() {
    openModal(
      <Modal title={`Delete ${site.name}?`} desc="This permanently deletes the site, its sources and every day of history kept for it. Export a CSV first if you might want it.">
        <div className="modal-actions">
          <button className="btn" onClick={closeModal}>Cancel</button>
          <button
            className="btn danger"
            onClick={async () => {
              const r = await api(`/api/sites/${site.id}`, "DELETE");
              closeModal();
              if ("error" in r) return toast(r.error, "error");
              router.push("/app");
              router.refresh();
            }}
          >
            Delete site and history
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <>
      <p className="view-intro">Preferences for this site.</p>
      <div className="card">
        <div className="set-list">
          <div className="set-row">
            <div className="l"><div className="t">Site name</div><div className="d">Shown across the dashboard</div></div>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Site name" />
          </div>
          <div className="set-row">
            <div className="l"><div className="t">Time zone</div><div className="d">Your reporting time zone</div></div>
            <select value={tz} onChange={(e) => setTz(e.target.value)} aria-label="Time zone">
              {zones.map((z) => <option key={z}>{z}</option>)}
            </select>
          </div>
          <div className="set-row">
            <div className="l"><div className="t">Daily auto-snapshot</div><div className="d">Fetch and store a snapshot from connected sources every day</div></div>
            <button className="tgl" aria-pressed={snap} aria-label="Daily auto-snapshot" onClick={() => setSnap(!snap)}><span className="switch" /></button>
          </div>
          <div className="set-row">
            <div className="l"><div className="t">Theme</div><div className="d">Light, dark, or follow your system (this browser)</div></div>
            <select
              value={theme}
              aria-label="Theme"
              onChange={(e) => {
                const v = e.target.value as typeof theme;
                setTheme(v);
                applyTheme(v);
              }}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>
        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button className="btn primary" onClick={save}>Save changes</button>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Danger zone</h3>
            <div className="sub">Deleting a site removes all of its kept history.</div>
          </div>
          <button className="btn sm danger" onClick={confirmDelete}>Delete site</button>
        </div>
      </div>
    </>
  );
}

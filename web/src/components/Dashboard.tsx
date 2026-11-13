"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { MetricRow, MonthRow, Site, SnapshotRow, SourceRow } from "@/lib/data";
import { LogoMark } from "./Logo";
import { NewSiteForm } from "./NewSiteForm";
import { monthLabel, postJson } from "./client";
import { RANGES, type Range } from "./stats";
import { TITLES, type View } from "./views";
import { OverviewView, TrendsView, HistoryView } from "./viewsData";
import { SnapshotsView, ImportView, SourcesView, SettingsView, AddSourceModal } from "./viewsManage";

export type DashProps = {
  view: View;
  user: { email: string };
  site: Site;
  sites: (Site & { sources: number; first_date: string | null })[];
  daily: MetricRow[];
  monthly: MonthRow[];
  sources: SourceRow[];
  snapshots: SnapshotRow[];
};

/* ---------------- shared UI context ---------------- */

type Ui = {
  toast: (msg: string, tone?: "ok" | "error") => void;
  openModal: (node: React.ReactNode) => void;
  closeModal: () => void;
  refresh: () => void;
  openAddSource: () => void;
};
const UiCtx = createContext<Ui | null>(null);
export const useUi = () => useContext(UiCtx)!;

export function Modal({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  const { closeModal } = useUi();
  return (
    <>
      <div className="mhead">
        <div>
          <h3>{title}</h3>
          {desc && <div className="mdesc">{desc}</div>}
        </div>
        <button className="x" aria-label="Close" onClick={closeModal}>×</button>
      </div>
      {children}
    </>
  );
}

const ICONS: Record<View, React.ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  trends: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  history: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v16" /></>,
  snapshots: <><path d="M12 3v18M5 8l7-5 7 5" /><rect x="4" y="8" width="16" height="13" rx="2" /></>,
  import: <><path d="M12 15V3M8 7l4-4 4 4" /><path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" /></>,
  sources: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>,
  settings: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2 2M17.1 17.1l2 2M19.1 4.9l-2 2M6.9 17.1l-2 2" /></>,
};
const Icon = ({ v }: { v: View }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONS[v]}</svg>
);

/* ---------------- theme ---------------- */

export function applyTheme(mode: "system" | "light" | "dark") {
  const r = document.documentElement;
  if (mode === "system") r.removeAttribute("data-theme");
  else r.setAttribute("data-theme", mode);
  try {
    if (mode === "system") localStorage.removeItem("ax-theme");
    else localStorage.setItem("ax-theme", mode);
  } catch {
    /* storage unavailable */
  }
}
function isDark() {
  const c = document.documentElement.getAttribute("data-theme");
  if (c) return c === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/* ---------------- shell ---------------- */

export function Dashboard(props: DashProps) {
  const { site, sites, user, sources } = props;
  const router = useRouter();
  // The dashboard already holds every view's data, so switching views happens here in the
  // browser (instant) and only the URL changes. Loading any view's URL directly still works.
  const [view, setView] = useState<View>(props.view);
  // Any fresh server render (navigation, router.refresh after a change) is the source of truth.
  useEffect(() => setView(props.view), [props]);
  const go = useCallback(
    (v: View) => {
      setView(v);
      window.history.pushState(null, "", `/app/${site.id}/${v}`);
      window.scrollTo({ top: 0 });
    },
    [site.id]
  );
  useEffect(() => {
    const onPop = () => {
      const v = window.location.pathname.split("/").pop() as View;
      if (v && v in TITLES) setView(v);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navTo = (v: View) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // let "open in new tab" work
    e.preventDefault();
    go(v);
  };
  const vp = { ...props, view };
  const [toasts, setToasts] = useState<{ id: number; msg: string; tone: "ok" | "error" }[]>([]);
  const [modal, setModal] = useState<React.ReactNode>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [range, setRange] = useState<Range>("all");

  useEffect(() => {
    try {
      const r = localStorage.getItem("ax-range") as Range | null;
      if (r && RANGES.some((x) => x.key === r)) setRange(r);
    } catch {
      /* ignore */
    }
  }, []);
  const pickRange = (r: Range) => {
    setRange(r);
    try {
      localStorage.setItem("ax-range", r);
    } catch {
      /* ignore */
    }
  };

  const toast = useCallback((msg: string, tone: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, tone }]);
    // errors stay up longer so there is time to read them
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 2800);
  }, []);
  const closeModal = useCallback(() => setModal(null), []);
  const ui: Ui = {
    toast,
    openModal: setModal,
    closeModal,
    refresh: () => router.refresh(),
    openAddSource: () => setModal(<AddSourceModal siteId={site.id} />),
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModal(null);
        setMenuOpen(false);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".site-wrap")) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, []);

  const siteSub = (s: DashProps["sites"][number]) =>
    `${s.sources} source${s.sources === 1 ? "" : "s"}${s.first_date ? ` · kept since ${monthLabel(s.first_date.slice(0, 7))}` : " · no data yet"}`;
  const current = sites.find((s) => s.id === site.id)!;
  const showRange = view === "overview" || view === "trends";

  async function signOut() {
    await postJson("/api/auth/logout");
    router.push("/login");
    router.refresh();
  }

  return (
    <UiCtx.Provider value={ui}>
      <div className="app">
        <aside className="side">
          <Link href="/" className="side-brand">
            <LogoMark />
            <span className="wordmark">Keep<span className="wm-accent">Stat</span></span>
          </Link>

          <div className="site-wrap">
            <button className="side-site" aria-haspopup="true" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              <span className="site-av" aria-hidden="true">{site.name.slice(0, 1).toUpperCase()}</span>
              <span className="site-txt">
                <span className="s-name">{site.name}</span>
                <span className="s-sub">{siteSub(current)}</span>
              </span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 9l5 5 5-5" /></svg>
            </button>
            {menuOpen && (
              <div className="menu">
                {sites.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setMenuOpen(false);
                      router.push(`/app/${s.id}/${view}`);
                    }}
                  >
                    <span className="mn">{s.name}</span>
                    <span className="ms">{siteSub(s)}</span>
                  </button>
                ))}
                <div className="div" />
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setModal(
                      <Modal title="Add a site" desc="Each site keeps its own history and sources.">
                        <NewSiteForm onDone={closeModal} />
                      </Modal>
                    );
                  }}
                >
                  <span className="mn add">+ Add a site</span>
                </button>
              </div>
            )}
          </div>

          <nav className="nav">
            {(["overview", "trends", "history"] as View[]).map((v) => (
              <a key={v} href={`/app/${site.id}/${v}`} onClick={navTo(v)} className={v === view ? "active" : ""} aria-current={v === view ? "page" : undefined}>
                <Icon v={v} /> {TITLES[v]}
              </a>
            ))}
            <div className="grp">Data</div>
            {(["snapshots", "import", "sources"] as View[]).map((v) => (
              <a key={v} href={`/app/${site.id}/${v}`} onClick={navTo(v)} className={v === view ? "active" : ""} aria-current={v === view ? "page" : undefined}>
                <Icon v={v} /> {TITLES[v]}
              </a>
            ))}
            <div className="grp">Account</div>
            <a href={`/app/${site.id}/settings`} onClick={navTo("settings")} className={view === "settings" ? "active" : ""} aria-current={view === "settings" ? "page" : undefined}>
              <Icon v="settings" /> {TITLES.settings}
            </a>
          </nav>

          <div className="side-foot">
            <div className="who">Signed in as <b>{user.email}</b></div>
            <button className="linkbtn" onClick={signOut}>Sign out</button>
          </div>
        </aside>

        <div className="main">
          <div className="topbar">
            <div className="tb-left">
              <span className="crumb">{site.name} /</span>
              <h1>{TITLES[view]}</h1>
            </div>
            <div className="tb-right">
              {showRange && (
                <div className="ranges" role="group" aria-label="Date range">
                  {RANGES.map((r) => (
                    <button key={r.key} aria-pressed={range === r.key} onClick={() => pickRange(r.key)}>
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
              <a className="btn" href={`/api/sites/${site.id}/export?granularity=month`}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M8 11l4 4 4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
                Export CSV
              </a>
              <button className="btn primary" onClick={ui.openAddSource}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                Add source
              </button>
              <button
                className="icon-btn"
                aria-label="Toggle theme"
                title="Toggle theme"
                onClick={() => applyTheme(isDark() ? "light" : "dark")}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4.2" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" /></svg>
              </button>
            </div>
          </div>

          <div className="content" key={view}>
            {view === "overview" && <OverviewView {...vp} range={range} />}
            {view === "trends" && <TrendsView {...vp} range={range} />}
            {view === "history" && <HistoryView {...vp} />}
            {view === "snapshots" && <SnapshotsView {...vp} />}
            {view === "import" && <ImportView {...vp} />}
            {view === "sources" && <SourcesView {...vp} />}
            {view === "settings" && <SettingsView {...vp} />}
            <div className="foot-note">
              KeepStat · {sources.length ? `${sources.filter((s) => s.active).length} live source${sources.filter((s) => s.active).length === 1 ? "" : "s"} · ` : ""}
              your data stays in this app&apos;s database
            </div>
          </div>
        </div>
      </div>

      {modal && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal" role="dialog" aria-modal="true">{modal}</div>
        </div>
      )}
      <div id="toast">
        {toasts.map((t) => (
          <div className={`toast${t.tone === "error" ? " error" : ""}`} key={t.id} role={t.tone === "error" ? "alert" : "status"}>
            {t.tone === "error" ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 8v5M12 16.5v.5" /><circle cx="12" cy="12" r="9" /></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
            )}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </UiCtx.Provider>
  );
}

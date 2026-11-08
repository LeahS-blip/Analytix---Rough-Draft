"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoMark } from "./Logo";
import { postJson } from "./client";

export const TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function guessTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Full-page onboarding (first) or inline form inside a modal. */
export function NewSiteForm({ first = false, onDone }: { first?: boolean; onDone?: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [tz, setTz] = useState("UTC");
  useEffect(() => setTz(guessTz()), []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const zones = TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await postJson<{ id: number }>("/api/sites", { name, timezone: tz });
    if ("error" in r) {
      setError(r.error);
      setBusy(false);
      return;
    }
    onDone?.();
    router.push(`/app/${r.id}/import`);
    router.refresh();
  }

  const form = (
    <form onSubmit={submit}>
      {error && <div className="err" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="siteName">Site name</label>
        <input id="siteName" placeholder="mysite.com" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <span className="hint">Usually the domain. You can rename it later.</span>
      </div>
      <div className="field">
        <label htmlFor="siteTz">Time zone</label>
        <select id="siteTz" value={tz} onChange={(e) => setTz(e.target.value)}>
          {zones.map((z) => (
            <option key={z}>{z}</option>
          ))}
        </select>
      </div>
      <button className="btn primary" type="submit" disabled={busy} style={first ? undefined : { width: "100%", justifyContent: "center" }}>
        {busy ? <span className="spin" /> : first ? "Create site & add data" : "Add site"}
      </button>
    </form>
  );

  if (!first) return form;
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand">
          <LogoMark className="" />
          <span className="wordmark">keep<span className="wm-accent">stat</span></span>
        </div>
        <h1>Add your first site</h1>
        <p className="lead">Next you&apos;ll connect Vercel or drop in an export — KeepStat keeps every day from then on.</p>
        {form}
      </div>
    </main>
  );
}

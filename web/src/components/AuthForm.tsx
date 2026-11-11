"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogoMark } from "./Logo";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).catch(() => null);
    if (!res) {
      setError("Couldn't reach the server.");
      setBusy(false);
      return;
    }
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Something went wrong.");
      setBusy(false);
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit}>
        <Link href="/" className="brand">
          <LogoMark className="" />
          <span className="wordmark">Keep<span className="wm-accent">Stat</span></span>
        </Link>
        <h1>{signup ? "Start keeping your history" : "Welcome back"}</h1>
        <p className="lead">
          {signup ? "Your first site is free forever. No card needed." : "Sign in to see everything you've kept."}
        </p>
        {error && <div className="err" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            required
            minLength={signup ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {signup && <span className="hint">At least 8 characters.</span>}
        </div>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? <span className="spin" /> : signup ? "Create account" : "Sign in"}
        </button>
        <p className="auth-alt">
          {signup ? (
            <>Already have an account? <Link href="/login">Sign in</Link></>
          ) : (
            <>New here? <Link href="/signup">Create an account</Link></>
          )}
        </p>
      </form>
    </main>
  );
}

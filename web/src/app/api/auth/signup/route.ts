import { NextResponse } from "next/server";
import { q, q1 } from "@/lib/db";
import { createSession, hashPassword, HttpError } from "@/lib/auth";
import { body, handle } from "@/lib/api";

export const POST = handle(async (req: Request) => {
  const { email, password } = await body<{ email?: string; password?: string }>(req);
  const e = (email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, "Enter a valid email address.");
  if (!password || password.length < 8) throw new HttpError(400, "Password must be at least 8 characters.");
  if (await q1("SELECT 1 FROM users WHERE email = $1", [e]))
    throw new HttpError(409, "An account with that email already exists. Sign in instead.");
  const [u] = await q<{ id: number }>(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
    [e, hashPassword(password)]
  );
  await createSession(u.id);
  return NextResponse.json({ ok: true });
});

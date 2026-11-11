import { NextResponse } from "next/server";
import { q1 } from "@/lib/db";
import { createSession, HttpError, verifyPassword } from "@/lib/auth";
import { body, handle } from "@/lib/api";

export const POST = handle(async (req: Request) => {
  const { email, password } = await body<{ email?: string; password?: string }>(req);
  const u = await q1<{ id: number; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE email = $1",
    [(email ?? "").trim().toLowerCase()]
  );
  if (!u || !password || !verifyPassword(password, u.password_hash))
    throw new HttpError(401, "Email or password is incorrect.");
  await createSession(u.id);
  return NextResponse.json({ ok: true });
});

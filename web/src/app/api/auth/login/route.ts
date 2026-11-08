import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, HttpError, verifyPassword } from "@/lib/auth";
import { body, handle } from "@/lib/api";

export const POST = handle(async (req: Request) => {
  const { email, password } = await body<{ email?: string; password?: string }>(req);
  const u = db()
    .prepare("SELECT id, password_hash FROM users WHERE email = ?")
    .get((email ?? "").trim().toLowerCase()) as { id: number; password_hash: string } | undefined;
  if (!u || !password || !verifyPassword(password, u.password_hash))
    throw new HttpError(401, "Email or password is incorrect.");
  await createSession(u.id);
  return NextResponse.json({ ok: true });
});

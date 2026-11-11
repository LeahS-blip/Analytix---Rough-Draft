import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { q, q1 } from "./db";

const COOKIE = "ax_session";
const SESSION_DAYS = 30;

export type User = { id: number; email: string };

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [, saltHex, hashHex] = stored.split("$");
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
}

export async function createSession(userId: number) {
  const id = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await q("INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)", [id, userId, expires.toISOString()]);
  (await cookies()).set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (id) await q("DELETE FROM sessions WHERE id = $1", [id]);
  jar.delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const id = (await cookies()).get(COOKIE)?.value;
  if (!id) return null;
  const row = await q1<{ id: number; email: string }>(
    "SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > now()",
    [id]
  );
  return row ? { id: row.id, email: row.email } : null;
}

/** For pages: redirect to /login when signed out. */
export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** For API routes: throw 401 when signed out. */
export async function apiUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "Not signed in");
  return u;
}

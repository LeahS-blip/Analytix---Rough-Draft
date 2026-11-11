import crypto from "node:crypto";
import { q, q1 } from "./db";

let key: Buffer | null = null;

/**
 * 32-byte key for encrypting source tokens.
 * Uses APP_SECRET when set (recommended). Otherwise a random key is generated
 * once and kept in the app_config table, so it survives serverless restarts.
 */
async function getKey(): Promise<Buffer> {
  if (key) return key;
  const env = process.env.APP_SECRET;
  if (env) return (key = crypto.createHash("sha256").update(env).digest());
  const row = await q1<{ value: string }>("SELECT value FROM app_config WHERE key = 'secret_key'");
  if (row) return (key = Buffer.from(row.value, "hex"));
  const fresh = crypto.randomBytes(32).toString("hex");
  await q("INSERT INTO app_config (key, value) VALUES ('secret_key', $1) ON CONFLICT (key) DO NOTHING", [fresh]);
  const saved = await q1<{ value: string }>("SELECT value FROM app_config WHERE key = 'secret_key'");
  return (key = Buffer.from(saved!.value, "hex"));
}

export async function encrypt(obj: unknown): Promise<string> {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", await getKey(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export async function decrypt<T>(s: string): Promise<T> {
  const [iv, tag, enc] = s.split(".").map((p) => Buffer.from(p, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", await getKey(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString("utf8")) as T;
}

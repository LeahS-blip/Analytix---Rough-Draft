import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db";

let key: Buffer | null = null;

/** 32-byte key from APP_SECRET, or a random one generated once into data/secret.key. */
function getKey(): Buffer {
  if (key) return key;
  const env = process.env.APP_SECRET;
  if (env) {
    key = crypto.createHash("sha256").update(env).digest();
    return key;
  }
  const file = path.join(DATA_DIR, "secret.key");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
  return key;
}

export function encrypt(obj: unknown): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decrypt<T>(s: string): T {
  const [iv, tag, enc] = s.split(".").map((p) => Buffer.from(p, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString("utf8")) as T;
}

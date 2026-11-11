/**
 * Postgres everywhere:
 *  - production (Vercel): DATABASE_URL from the Neon integration
 *  - local dev: PGlite, a real Postgres compiled to WASM, stored in ./data/pg
 * Both speak the same SQL, so there is one schema and one set of queries.
 */
import path from "node:path";
import fs from "node:fs";
import type { Sql, TransactionSql } from "postgres";

export type Row = Record<string, unknown>;
export interface Db {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (q: Db) => Promise<T>): Promise<T>;
}

export const DATA_DIR = process.env.KEEPSTAT_DATA_DIR || path.join(process.cwd(), "data");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS sites (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  auto_snapshot BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One row per site per period. granularity 'day' (date = YYYY-MM-DD) or
-- 'month' (date = YYYY-MM-01, for imports that only have monthly totals).
CREATE TABLE IF NOT EXISTS metrics (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  granularity TEXT NOT NULL CHECK (granularity IN ('day','month')),
  date TEXT NOT NULL,
  visitors INTEGER,
  pageviews INTEGER,
  bounce_rate DOUBLE PRECISION,
  origin TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, granularity, date)
);
CREATE TABLE IF NOT EXISTS sources (
  id SERIAL PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  config_enc TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS snapshots (
  id SERIAL PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  rows INTEGER NOT NULL DEFAULT 0,
  range_from TEXT,
  range_to TEXT,
  visitors INTEGER,
  error TEXT,
  raw TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS snapshots_site ON snapshots(site_id, created_at DESC);
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

async function connectPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import("postgres");
  // prepare:false so it works through Neon's pooled (PgBouncer) connection string.
  const sql = postgres(url, {
    prepare: false,
    max: Number(process.env.KEEPSTAT_DB_POOL || 5),
    idle_timeout: 20,
    connect_timeout: 15,
  });
  const wrap = (s: Sql | TransactionSql): Db => ({
    query: async <T,>(text: string, params: unknown[] = []) =>
      (await s.unsafe(text, params as never[])) as unknown as T[],
    tx: async <T,>(fn: (q: Db) => Promise<T>) =>
      (await sql.begin((t) => fn(wrap(t)))) as T,
  });
  // .simple() runs the multi-statement schema in one round trip (the extended protocol allows one statement).
  await sql.unsafe(SCHEMA).simple();
  return wrap(sql);
}

async function connectPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = path.join(DATA_DIR, "pg");
  fs.mkdirSync(dir, { recursive: true });
  const pg = new PGlite(dir);
  await pg.exec(SCHEMA);
  type Q = { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }> };
  const wrap = (c: Q): Db => ({
    query: async <T,>(text: string, params: unknown[] = []) => (await c.query(text, params)).rows as T[],
    tx: async <T,>(fn: (q: Db) => Promise<T>) => pg.transaction((t) => fn(wrap(t as unknown as Q))) as Promise<T>,
  });
  return wrap(pg as unknown as Q);
}

declare global {
  // eslint-disable-next-line no-var
  var __keepstatDb: Promise<Db> | undefined;
}

/**
 * The Postgres connection string. Vercel's Neon integration names it DATABASE_URL / POSTGRES_URL,
 * or e.g. STORAGE_DATABASE_URL when a custom prefix is set, so accept any of those (pooled ones only).
 */
export function databaseUrl(): string | undefined {
  const env = process.env;
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.POSTGRES_URL) return env.POSTGRES_URL;
  const key = Object.keys(env)
    .filter((k) => /(^|_)(DATABASE_URL|POSTGRES_URL)$/.test(k))
    .sort()[0];
  return key ? env[key] : undefined;
}

export function db(): Promise<Db> {
  if (!globalThis.__keepstatDb) {
    const url = databaseUrl();
    if (!url && process.env.VERCEL)
      throw new Error("DATABASE_URL is not set. Add a Neon database to this Vercel project (Storage tab).");
    globalThis.__keepstatDb = (url ? connectPostgres(url) : connectPglite()).catch((e) => {
      globalThis.__keepstatDb = undefined; // retry on next request
      throw e;
    });
  }
  return globalThis.__keepstatDb;
}

/** Shorthand: run one query on the shared connection. */
export async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await db()).query<T>(text, params);
}
export async function q1<T = Row>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(text, params))[0];
}

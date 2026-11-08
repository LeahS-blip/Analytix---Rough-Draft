import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.KEEPSTAT_DATA_DIR || path.join(process.cwd(), "data");

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  auto_snapshot INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per site per period. granularity 'day' (date = YYYY-MM-DD) or
-- 'month' (date = YYYY-MM-01, for imports that only have monthly totals).
CREATE TABLE IF NOT EXISTS metrics (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  granularity TEXT NOT NULL CHECK (granularity IN ('day','month')),
  date TEXT NOT NULL,
  visitors INTEGER,
  pageviews INTEGER,
  bounce_rate REAL,
  origin TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (site_id, granularity, date)
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  config_enc TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_success_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,            -- 'vercel' | 'csv' | 'json'
  label TEXT NOT NULL,
  status TEXT NOT NULL,          -- 'ok' | 'error'
  rows INTEGER NOT NULL DEFAULT 0,
  range_from TEXT,
  range_to TEXT,
  visitors INTEGER,
  error TEXT,
  raw TEXT,                      -- original payload / file, kept as the receipt
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS snapshots_site ON snapshots(site_id, created_at DESC);
`;

declare global {
  // eslint-disable-next-line no-var
  var __keepstatDb: DatabaseSync | undefined;
}

export function db(): DatabaseSync {
  if (!globalThis.__keepstatDb) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Databases created before the rename are named analytix.db — keep using one if present.
    const legacy = path.join(DATA_DIR, "analytix.db");
    const file = fs.existsSync(legacy) && !fs.existsSync(path.join(DATA_DIR, "keepstat.db")) ? legacy : path.join(DATA_DIR, "keepstat.db");
    const d = new DatabaseSync(file);
    d.exec(SCHEMA);
    globalThis.__keepstatDb = d;
  }
  return globalThis.__keepstatDb;
}

export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN");
  try {
    const r = fn();
    d.exec("COMMIT");
    return r;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

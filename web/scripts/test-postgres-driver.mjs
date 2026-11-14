// Exercises the production database path (the `postgres` driver used with Neon)
// against an in-memory Postgres served over a socket. Run: node scripts/test-postgres-driver.mjs
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";
import assert from "node:assert/strict";

const pg = await PGlite.create();
const server = new PGLiteSocketServer({ db: pg, port: 5499, host: "127.0.0.1" });
await server.start();

const sql = postgres("postgres://postgres:postgres@127.0.0.1:5499/postgres", { prepare: false, max: 1 });
try {
  // 1. Multi-statement schema must run in one call (this is what db.ts does on cold start).
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS t1 (id SERIAL PRIMARY KEY, n TEXT);
                    CREATE TABLE IF NOT EXISTS m (site_id INT, g TEXT, date TEXT, v INT, p INT, b FLOAT8, PRIMARY KEY (site_id, g, date));`).simple();
  // 2. RETURNING id
  const [{ id }] = await sql.unsafe("INSERT INTO t1 (n) VALUES ($1) RETURNING id", ["a"]);
  assert.equal(id, 1);
  // 3. Bulk upsert with unnest over JS arrays, including nulls
  const up = `INSERT INTO m SELECT $1, $2, t.d, t.v, t.p, t.b FROM unnest($3::text[], $4::int[], $5::int[], $6::float8[]) AS t(d, v, p, b)
              ON CONFLICT (site_id, g, date) DO UPDATE SET v = COALESCE(EXCLUDED.v, m.v)`;
  await sql.unsafe(up, [1, "day", ["2026-01-01", "2026-01-02"], [10, null], [20, 5], [42.5, null]]);
  await sql.unsafe(up, [1, "day", ["2026-01-02"], [7], [9], [null]]);
  const rows = await sql.unsafe("SELECT date, v, p, b FROM m ORDER BY date");
  assert.deepEqual(rows.map((r) => [r.date, r.v, r.p, r.b]), [["2026-01-01", 10, 20, 42.5], ["2026-01-02", 7, 5, null]]);
  // 4. Aggregates cast to int come back as numbers, not strings
  const [agg] = await sql.unsafe("SELECT SUM(v)::int AS s, COUNT(*)::int AS c, AVG(b)::float8 AS a FROM m");
  assert.deepEqual([agg.s, agg.c, agg.a], [17, 2, 42.5]);
  // 5. Transactions
  await sql.begin(async (t) => { await t.unsafe("INSERT INTO t1 (n) VALUES ($1)", ["b"]); });
  assert.equal((await sql.unsafe("SELECT COUNT(*)::int AS c FROM t1"))[0].c, 2);
  console.log("postgres driver path: all checks passed");

  // 6. The app's own db.ts, connected the way it is on Vercel (DATABASE_URL set).
  //    (The test socket serves one client at a time, so release the first one.)
  await sql.end();
  process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5499/postgres";
  const { q, q1, db } = await import("../src/lib/db.ts");
  const [{ id: uid }] = await q("INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id", ["a@b.test", "x"]);
  const sid = (await q1("INSERT INTO sites (user_id, name) VALUES ($1, $2) RETURNING id", [uid, "s.dev"])).id;
  await (await db()).tx(async (t) => { await t.query("UPDATE sites SET auto_snapshot = $1 WHERE id = $2", [false, sid]); });
  const site = await q1("SELECT auto_snapshot, created_at FROM sites WHERE id = $1", [sid]);
  assert.equal(site.auto_snapshot, false);
  assert.ok(site.created_at instanceof Date);
  const sess = await q1("SELECT now() > now() - interval '20 hours' AS ok");
  assert.equal(sess.ok, true);
  // 7. Schema version is recorded, so the next cold start skips the DDL; max_days exists.
  assert.equal((await q1("SELECT value FROM app_config WHERE key = 'schema_version'")).value, "4");
  const srcId = (await q1("INSERT INTO sources (site_id, kind, label, config_enc) VALUES ($1, 'vercel', 'v', 'x') RETURNING id", [sid])).id;
  const learn = "UPDATE sources SET max_days = CASE WHEN $2::int < $3::int THEN $2::int ELSE max_days END WHERE id = $1";
  await q(learn, [srcId, 30, 730]); // Vercel shrank the range: remember 30
  assert.equal((await q1("SELECT max_days FROM sources WHERE id = $1", [srcId])).max_days, 30);
  await q(learn, [srcId, 100, 35]); // no shrink (100 is not < 35 numerically): keep 30
  assert.equal((await q1("SELECT max_days FROM sources WHERE id = $1", [srcId])).max_days, 30);
  console.log("app db.ts on the postgres driver: all checks passed");
  process.exit(0);
} finally {
  await sql.end().catch(() => {});
  await server.stop();
  await pg.close();
}

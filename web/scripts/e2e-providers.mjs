// End-to-end check of every connector against scripts/mock-providers.mjs.
// Needs: the mock running, and the app running locally with the mock URLs in .env.local
// (see the top of mock-providers.mjs). Run: node scripts/e2e-providers.mjs [http://localhost:3000]
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const APP = process.argv[2] || "http://localhost:3000";
let cookie = "";
async function call(path, body, method = body ? "POST" : "GET", headers = {}) {
  const r = await fetch(APP + path, {
    method,
    headers: { "content-type": "application/json", cookie, ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { text }; }
  return { status: r.status, json };
}

const T = "local-test-token";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const gaKey = JSON.stringify({ type: "service_account", client_email: "test@local.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });

const r0 = await call("/api/auth/signup", { email: `e2e-${Date.now()}@example.test`, password: "test-password-123" });
assert.equal(r0.status, 200, JSON.stringify(r0.json));

const cases = [
  { kind: "vercel", fields: { token: T }, minRows: 30 },
  { kind: "plausible", fields: { key: T, site: "leahbuilds.dev" }, minRows: 300 },
  { kind: "umami", fields: { apiKey: T }, minRows: 300 },
  { kind: "cloudflare", fields: { token: T }, minRows: 150 },
  { kind: "ga4", fields: { key: gaKey }, minRows: 300 },
  { kind: "github", fields: { token: T }, minRows: 14 },
];

const sites = {};
for (const c of cases) {
  const s = await call("/api/sites", { name: `${c.kind}.test` });
  sites[c.kind] = s.json.id;
  const t0 = Date.now();
  const opt = await call(`/api/connect/${c.kind}/options`, { fields: c.fields });
  assert.equal(opt.status, 200, `${c.kind} options: ${JSON.stringify(opt.json)}`);
  const choice = opt.json.choices[0]?.id ?? null;
  const con = await call(`/api/sites/${s.json.id}/sources`, { kind: c.kind, fields: c.fields, choice });
  assert.equal(con.status, 200, `${c.kind} connect: ${JSON.stringify(con.json)}`);
  assert.ok(con.json.first.ok, `${c.kind} first fetch: ${con.json.first.error}`);
  assert.ok(con.json.first.rows >= c.minRows, `${c.kind}: only ${con.json.first.rows} rows`);
  // a second run (the daily refetch) works too
  const again = await call(`/api/sources/${con.json.id}/run`, {});
  assert.equal(again.status, 200, `${c.kind} refetch: ${JSON.stringify(again.json)}`);
  console.log(`✓ ${c.kind.padEnd(10)} ${String(con.json.first.rows).padStart(4)} days, refetch ${again.json.rows}, ${Date.now() - t0} ms`);
}

// wrong credentials give a readable error, not a crash
const bad = await call("/api/connect/plausible/options", { fields: { key: "nope", site: "x.dev" } });
assert.equal(bad.status, 200); // plausible has no list step
const badc = await call(`/api/sites/${sites.plausible}/sources`, { kind: "plausible", fields: { key: "nope", site: "leahbuilds.dev" } });
assert.equal(badc.status, 400);
assert.match(badc.json.error, /Plausible rejected the key/);
console.log("✓ bad key   →", badc.json.error.slice(0, 60) + "…");

// push API
const ps = await call("/api/sites", { name: "push.test" });
const push = await call(`/api/sites/${ps.json.id}/sources`, { kind: "push", fields: { label: "My script" } });
assert.equal(push.status, 200);
assert.match(push.json.key, /^ks_/);
const auth = { authorization: `Bearer ${push.json.key}` };
const day = (o) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
const rows = Array.from({ length: 40 }, (_, i) => ({ date: day(-40 + i), visitors: 50 + i, pageviews: 90 + i, bounce_rate: 45 - i / 4 }));
let r = await call("/api/ingest", { rows }, "POST", auth);
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.equal(r.json.days, 40);
r = await call("/api/ingest", { visitors: 77, pages: [{ key: "/", visitors: 50, pageviews: 70 }], referrers: [{ key: "chatgpt.com", visitors: 9 }] }, "POST", auth);
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.equal(r.json.details, 2);
r = await call("/api/ingest", { date: "bad", visitors: 1 }, "POST", auth);
assert.equal(r.status, 400);
r = await call("/api/ingest", { visitors: 1 }, "POST", { authorization: "Bearer ks_wrong" });
assert.equal(r.status, 401);
console.log("✓ push      41 days + details, bad date → 400, bad key → 401");

console.log("\nsites:", JSON.stringify(sites), "push:", ps.json.id);
console.log("all provider checks passed");

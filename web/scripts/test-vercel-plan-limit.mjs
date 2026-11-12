// Checks that fetching shrinks to the Vercel plan's allowed range instead of failing.
// Run: node scripts/test-vercel-plan-limit.mjs
import assert from "node:assert/strict";

const calls = [];
const day = (o) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
const oldest = day(-30); // Hobby: "latest 31 days" = today and the 30 before it

globalThis.fetch = async (url) => {
  const u = new URL(url);
  calls.push(u.searchParams.get("since"));
  if (u.searchParams.get("since") < oldest) {
    // Vercel's real response for a Hobby project
    return new Response(JSON.stringify({ error: { message: "Invalid request: the hobby plan only grants access to the latest 31 days of data." } }), { status: 400 });
  }
  return new Response(JSON.stringify({ data: [{ timestamp: day(-1) + "T00:00:00.000Z", visitors: 5, pageviews: 9 }] }), { status: 200 });
};

const { fetchRecentDays, planLimitDays, VercelError } = await import("../src/lib/vercel.ts");
const cfg = { token: "t", projectId: "p", projectName: "p" };

// the daily refetch (35 days) used to fail on Hobby; now it shrinks to 30
let r = await fetchRecentDays(cfg, 35);
assert.equal(r.days, 30);
assert.deepEqual(calls, [day(-35), day(-30)]);
assert.equal(r.points[0].visitors, 5);

// the first backfill (730 days) goes straight to the allowed range
calls.length = 0;
r = await fetchRecentDays(cfg, 730);
assert.equal(r.days, 30);
assert.equal(calls.length, 2);

// a range that already fits makes one request
calls.length = 0;
r = await fetchRecentDays(cfg, 20);
assert.equal(r.days, 20);
assert.equal(calls.length, 1);

// other errors still surface (no endless retrying)
assert.equal(planLimitDays(new VercelError(401, "Vercel rejected the token.")), null);
globalThis.fetch = async () => new Response("{}", { status: 401 });
await assert.rejects(() => fetchRecentDays(cfg, 35), /rejected the token/);

console.log("Vercel plan-limit handling: all checks passed");

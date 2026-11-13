// A local stand-in for Vercel's Web Analytics API, shaped like a Hobby project:
// 30 days of traffic, a weekday pattern, a Hacker News spike 8 days ago, and the
// "latest 31 days" plan limit. Run: node scripts/mock-vercel.mjs  (port 5099)
import http from "node:http";

const DAY = 864e5;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
const oldest = iso(today - 30 * DAY);
const spike = iso(today - 8 * DAY);

function visitors(d) {
  const t = Date.parse(d);
  const i = Math.round((t - (today - 30 * DAY)) / DAY);
  const wk = [0.6, 1.0, 1.15, 1.1, 1.0, 0.8, 0.55][new Date(t).getUTCDay()];
  let v = Math.round((40 + i * 0.8) * wk);
  if (d === spike) v *= 4;
  return v;
}
const pages = [["/", 0.38], ["/blog/shipping-fast", 0.22], ["/projects", 0.18], ["/about", 0.12], ["/pricing", 0.1]];
const refs = [["(direct)", 0.45], ["google.com", 0.3], ["github.com", 0.15], ["x.com", 0.1]];
const countries = [["US", 0.48], ["GB", 0.14], ["DE", 0.12], ["CA", 0.1], ["IN", 0.08], ["FR", 0.08]];
const devices = [["desktop", 0.64], ["mobile", 0.33], ["tablet", 0.03]];

function breakdown(dim, days) {
  const total = days.reduce((s, d) => s + visitors(d), 0);
  const hn = days.includes(spike) ? visitors(spike) * 0.7 : 0; // most of the spike came from HN
  const base = total - hn;
  const mk = (list) => list.map(([k, share]) => ({ k, v: Math.round(base * share) }));
  let rows;
  if (dim === "requestPath") {
    rows = mk(pages);
    if (hn) rows.find((r) => r.k === "/blog/shipping-fast").v += Math.round(hn);
    return rows.map((r) => ({ requestPath: r.k, visitors: r.v, pageviews: Math.round(r.v * 1.6) }));
  }
  if (dim === "referrerHostname") {
    rows = mk(refs).map((r) => ({ referrerHostname: r.k === "(direct)" ? "" : r.k, visitors: r.v, pageviews: Math.round(r.v * 1.6) }));
    if (hn) rows.push({ referrerHostname: "news.ycombinator.com", visitors: Math.round(hn), pageviews: Math.round(hn * 1.3) });
    return rows;
  }
  if (dim === "country") return mk(countries).map((r) => ({ country: r.k, visitors: r.v, pageviews: Math.round(r.v * 1.6) }));
  if (dim === "deviceType") return mk(devices).map((r) => ({ deviceType: r.k, visitors: r.v, pageviews: Math.round(r.v * 1.6) }));
  return [];
}

http
  .createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== "Bearer local-test-token") return send(403, { error: { message: "Not authorized" } });
    if (u.pathname === "/v2/teams") return send(200, { teams: [] });
    if (u.pathname === "/v9/projects") return send(200, { projects: [{ id: "prj_local", name: "leahbuilds" }] });
    if (u.pathname !== "/v1/query/web-analytics/visits/aggregate") return send(404, { error: { message: "nope" } });
    const since = u.searchParams.get("since"), until = u.searchParams.get("until"), by = u.searchParams.get("by");
    if (since < oldest) return send(400, { error: { message: "Invalid request: the hobby plan only grants access to the latest 31 days of data." } });
    const days = [];
    for (let t = Date.parse(since); t <= Date.parse(until); t += DAY) days.push(iso(t));
    if (by === "day") return send(200, { data: days.map((d) => ({ timestamp: d + "T00:00:00.000Z", visitors: visitors(d), pageviews: Math.round(visitors(d) * 1.6) })) });
    return send(200, { data: breakdown(by, days) });
  })
  .listen(5099, "127.0.0.1", () => console.log("mock Vercel on http://127.0.0.1:5099 (oldest allowed " + oldest + ", spike " + spike + ")"));

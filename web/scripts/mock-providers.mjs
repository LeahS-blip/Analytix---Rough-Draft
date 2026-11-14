// Local stand-ins for every provider KeepStat connects to, shaped like their real APIs.
// Run: node scripts/mock-providers.mjs   (port 5099), then start the app with these in .env.local:
//
//   KEEPSTAT_VERCEL_API=http://127.0.0.1:5099
//   KEEPSTAT_PLAUSIBLE_API=http://127.0.0.1:5099/plausible
//   KEEPSTAT_UMAMI_API=http://127.0.0.1:5099/umami/v1
//   KEEPSTAT_CLOUDFLARE_API=http://127.0.0.1:5099/cf
//   KEEPSTAT_GA4_DATA_API=http://127.0.0.1:5099/ga/data
//   KEEPSTAT_GA4_ADMIN_API=http://127.0.0.1:5099/ga/admin
//   KEEPSTAT_GA4_TOKEN_URI=http://127.0.0.1:5099/ga/token
//   KEEPSTAT_GITHUB_API=http://127.0.0.1:5099/gh
//
// Every provider accepts the secret "local-test-token" (GA4: any service-account JSON whose
// client_email is test@local.iam.gserviceaccount.com). Vercel behaves like Hobby (31 days);
// Plausible/Umami/GA4 have 400 days of history; Cloudflare 180; GitHub 14.
import http from "node:http";

const DAY = 864e5;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
const spike = iso(today - 8 * DAY);
const T = "local-test-token";

function visitors(d) {
  const t = Date.parse(d);
  const i = Math.round((t - (today - 400 * DAY)) / DAY); // grows over 400 days
  const wk = [0.6, 1.0, 1.15, 1.1, 1.0, 0.8, 0.55][new Date(t).getUTCDay()];
  let v = Math.round((25 + i * 0.12) * wk);
  if (d === spike) v *= 4;
  return v;
}
const range = (since, until) => { const o = []; for (let t = Date.parse(since); t <= Date.parse(until); t += DAY) if (t <= today) o.push(iso(t)); return o; };
const pages = [["/", 0.38], ["/blog/shipping-fast", 0.22], ["/projects", 0.18], ["/about", 0.12], ["/pricing", 0.1]];
const refs = [["(direct)", 0.4], ["google.com", 0.25], ["github.com", 0.12], ["x.com", 0.08], ["chatgpt.com", 0.06], ["perplexity.ai", 0.03], ["duckduckgo.com", 0.06]];
const countries = [["US", 0.48], ["GB", 0.14], ["DE", 0.12], ["CA", 0.1], ["IN", 0.08], ["FR", 0.08]];
const devices = [["desktop", 0.64], ["mobile", 0.33], ["tablet", 0.03]];
const LISTS = { page: pages, ref: refs, country: countries, device: devices };

/** [{k, v}] for a dimension over some days; most of the spike came from HN to one post. */
function breakdown(dim, days) {
  const total = days.reduce((s, d) => s + visitors(d), 0);
  const hn = days.includes(spike) ? visitors(spike) * 0.7 : 0;
  const rows = LISTS[dim].map(([k, share]) => ({ k, v: Math.round((total - hn) * share) }));
  if (hn && dim === "page") rows.find((r) => r.k === "/blog/shipping-fast").v += Math.round(hn);
  if (hn && dim === "ref") rows.push({ k: "news.ycombinator.com", v: Math.round(hn) });
  if (hn && (dim === "country" || dim === "device")) rows[0].v += Math.round(hn);
  // a referrer that only appeared recently
  if (dim === "ref") { const n = days.filter((d) => d >= iso(today - 20 * DAY)).length * 2; if (n) rows.push({ k: "bsky.app", v: n }); }
  return rows.sort((a, b) => b.v - a.v);
}
const bounce = (d) => 40 + ((Date.parse(d) / DAY) % 7) - Math.min(8, Math.max(0, (Date.parse(d) - (today - 60 * DAY)) / DAY / 7));

function readBody(req) {
  return new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r(Object.fromEntries(new URLSearchParams(b))); } }); });
}

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const p = u.pathname;
    const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const auth = req.headers.authorization || "";
    const body = req.method === "POST" ? await readBody(req) : {};

    /* ---------- GA4 (token first: no bearer yet) ---------- */
    if (p === "/ga/token") {
      const payload = JSON.parse(Buffer.from(String(body.assertion).split(".")[1], "base64url").toString());
      if (payload.iss !== "test@local.iam.gserviceaccount.com") return send(400, { error: "invalid_grant" });
      return send(200, { access_token: "ga-" + T, expires_in: 3600 });
    }
    if (p.startsWith("/ga/")) {
      if (auth !== `Bearer ga-${T}`) return send(401, { error: { message: "unauthenticated" } });
      if (p === "/ga/admin/accountSummaries") return send(200, { accountSummaries: [{ displayName: "Leah", propertySummaries: [{ property: "properties/123456", displayName: "leahbuilds.dev" }] }] });
      if (p === "/ga/data/properties/123456:runReport") {
        const { startDate, endDate } = body.dateRanges[0];
        const s = /daysAgo/.test(startDate) ? iso(today - parseInt(startDate) * DAY) : startDate < iso(today - 400 * DAY) ? iso(today - 400 * DAY) : startDate;
        const e = endDate === "today" ? iso(today) : endDate;
        const days = range(s, e);
        const dim = body.dimensions?.[0]?.name;
        if (!dim) return send(200, { rows: [{ dimensionValues: [], metricValues: [{ value: "1" }] }] });
        if (dim === "date")
          return send(200, { rowCount: days.length, rows: days.map((d) => ({ dimensionValues: [{ value: d.replaceAll("-", "") }], metricValues: [{ value: String(visitors(d)) }, { value: String(Math.round(visitors(d) * 1.7)) }, { value: String(bounce(d) / 100) }] })) });
        const map = { pagePath: "page", sessionSource: "ref", countryId: "country", deviceCategory: "device" };
        const rows = breakdown(map[dim], days).map((r) => ({ dimensionValues: [{ value: r.k === "(direct)" ? "(direct)" : r.k.replace(".com", "") }], metricValues: [{ value: String(r.v) }, { value: String(Math.round(r.v * 1.7)) }] }));
        return send(200, { rows: rows.slice(0, body.limit || 100) });
      }
      return send(404, { error: { message: "nope" } });
    }

    /* ---------- Plausible ---------- */
    if (p === "/plausible/api/v2/query") {
      if (auth !== `Bearer ${T}`) return send(401, { error: "Invalid API key" });
      if (body.site_id !== "leahbuilds.dev") return send(400, { error: `Site does not exist or user does not have access to it.` });
      let days;
      if (Array.isArray(body.date_range)) days = range(body.date_range[0] < iso(today - 400 * DAY) ? iso(today - 400 * DAY) : body.date_range[0], body.date_range[1]);
      else days = range(iso(today - 7 * DAY), iso(today));
      const d0 = body.dimensions?.[0];
      if (!d0) return send(200, { results: [{ dimensions: [], metrics: [days.reduce((s, d) => s + visitors(d), 0)] }] });
      if (d0 === "time:day") return send(200, { results: days.map((d) => ({ dimensions: [d], metrics: [visitors(d), Math.round(visitors(d) * 1.6), Math.round(bounce(d))] })) });
      const map = { "event:page": "page", "visit:source": "ref", "visit:country": "country", "visit:device": "device" };
      const rows = breakdown(map[d0], days).map((r) => {
        const k = map[d0] === "ref" ? ({ "(direct)": "Direct / None", "google.com": "Google", "x.com": "Twitter", "chatgpt.com": "ChatGPT", "news.ycombinator.com": "Hacker News", "duckduckgo.com": "DuckDuckGo" }[r.k] ?? r.k) : map[d0] === "device" ? r.k[0].toUpperCase() + r.k.slice(1) : r.k;
        return { dimensions: [k], metrics: body.metrics.length > 1 ? [r.v, Math.round(r.v * 1.6)] : [r.v] };
      });
      return send(200, { results: rows.slice(0, body.pagination?.limit ?? 10000) });
    }

    /* ---------- Umami Cloud ---------- */
    if (p.startsWith("/umami/v1/")) {
      if (req.headers["x-umami-api-key"] !== T) return send(401, { error: "Unauthorized" });
      if (p === "/umami/v1/websites") return send(200, { data: [{ id: "web-1", name: "Leah Builds", domain: "leahbuilds.dev" }], count: 1 });
      if (p === "/umami/v1/websites/web-1") return send(200, { id: "web-1", name: "Leah Builds", domain: "leahbuilds.dev" });
      const s = iso(Math.max(Number(u.searchParams.get("startAt")), today - 400 * DAY)), e = iso(Number(u.searchParams.get("endAt")));
      const days = range(s, e);
      if (p === "/umami/v1/websites/web-1/pageviews")
        return send(200, { pageviews: days.map((d) => ({ x: d + " 00:00:00", y: Math.round(visitors(d) * 1.6) })), sessions: days.map((d) => ({ x: d + " 00:00:00", y: visitors(d) })) });
      if (p === "/umami/v1/websites/web-1/metrics") {
        const t = u.searchParams.get("type");
        if (t === "url") return send(400, { error: "Invalid type" }); // newer Umami: "path"
        const map = { path: "page", referrer: "ref", country: "country", device: "device" };
        return send(200, breakdown(map[t], days).map((r) => ({ x: r.k === "(direct)" ? "" : r.k, y: r.v })));
      }
      return send(404, { error: "nope" });
    }

    /* ---------- Cloudflare ---------- */
    if (p.startsWith("/cf/")) {
      if (auth !== `Bearer ${T}`) return send(403, { success: false, errors: [{ code: 10000, message: "Authentication error" }] });
      if (p === "/cf/accounts") return send(200, { success: true, result: [{ id: "acc1", name: "Leah's account" }] });
      if (p === "/cf/accounts/acc1/rum/site_info/list") return send(200, { success: true, result: [{ site_tag: "tag1", host: "leahbuilds.dev" }] });
      if (p === "/cf/graphql") {
        const f = body.variables.filter.AND;
        const s = f[0].date_geq, e = f[0].date_leq;
        if (s < iso(today - 182 * DAY)) return send(200, { data: null, errors: [{ message: "cannot request data older than 182 days" }] });
        if (Date.parse(e) - Date.parse(s) > 31 * DAY) return send(200, { data: null, errors: [{ message: "time range too wide; max 31 days" }] });
        const days = range(s, e);
        const dimsField = /dimensions \{ (\w+) \}/.exec(body.query)[1];
        let groups;
        if (dimsField === "date") groups = days.map((d) => ({ count: Math.round(visitors(d) * 1.5), sum: { visits: visitors(d) }, dimensions: { date: d } }));
        else {
          const map = { requestPath: "page", refererHost: "ref", countryName: "country", deviceType: "device" };
          groups = breakdown(map[dimsField], days).map((r) => ({ count: Math.round(r.v * 1.5), sum: { visits: r.v }, dimensions: { [dimsField]: r.k === "(direct)" ? "" : r.k } }));
        }
        return send(200, { data: { viewer: { accounts: [{ rumPageloadEventsAdaptiveGroups: groups }] } }, errors: null });
      }
      return send(404, { success: false, errors: [{ message: "nope" }] });
    }

    /* ---------- GitHub ---------- */
    if (p.startsWith("/gh/")) {
      if (auth !== `Bearer ${T}`) return send(401, { message: "Bad credentials" });
      if (p === "/gh/user/repos") return send(200, [{ full_name: "leah/keepstat", private: false, permissions: { push: true } }, { full_name: "someone/else", private: false, permissions: { push: false } }]);
      const days = range(iso(today - 13 * DAY), iso(today));
      if (p === "/gh/repos/leah/keepstat/traffic/views") return send(200, { count: 0, uniques: 0, views: days.map((d) => ({ timestamp: d + "T00:00:00Z", count: Math.round(visitors(d) * 2.2), uniques: Math.round(visitors(d) / 3) })) });
      if (p === "/gh/repos/leah/keepstat/traffic/popular/paths") return send(200, [{ path: "/leah/keepstat", title: "keepstat", count: 300, uniques: 90 }, { path: "/leah/keepstat/blob/main/README.md", title: "README", count: 80, uniques: 40 }]);
      if (p === "/gh/repos/leah/keepstat/traffic/popular/referrers") return send(200, [{ referrer: "news.ycombinator.com", count: 120, uniques: 70 }, { referrer: "Google", count: 60, uniques: 35 }]);
      return send(404, { message: "Not Found" });
    }

    /* ---------- Vercel (Hobby: latest 31 days) ---------- */
    if (auth !== `Bearer ${T}`) return send(403, { error: { message: "Not authorized" } });
    if (p === "/v2/teams") return send(200, { teams: [] });
    if (p === "/v9/projects") return send(200, { projects: [{ id: "prj_local", name: "leahbuilds" }] });
    if (p !== "/v1/query/web-analytics/visits/aggregate") return send(404, { error: { message: "nope" } });
    const since = u.searchParams.get("since"), until = u.searchParams.get("until"), by = u.searchParams.get("by");
    if (since < iso(today - 30 * DAY)) return send(400, { error: { message: "Invalid request: the hobby plan only grants access to the latest 31 days of data." } });
    const days = range(since, until);
    if (by === "day") return send(200, { data: days.map((d) => ({ timestamp: d + "T00:00:00.000Z", visitors: visitors(d), pageviews: Math.round(visitors(d) * 1.6) })) });
    const map = { requestPath: "page", referrerHostname: "ref", country: "country", deviceType: "device" };
    return send(200, { data: breakdown(map[by], days).map((r) => ({ [by]: r.k === "(direct)" ? "" : r.k, visitors: r.v, pageviews: Math.round(r.v * 1.6) })) });
  })
  .listen(5099, "127.0.0.1", () => console.log("mock providers on http://127.0.0.1:5099 (spike " + spike + ")"));

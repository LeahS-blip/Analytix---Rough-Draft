/**
 * Google Analytics 4 via the Analytics Data API, using a service account.
 * The user creates a service account key (JSON) and adds the service account's email
 * to the GA4 property as a Viewer. No OAuth app or Google review needed.
 */
import { createSign } from "node:crypto";
import { getJson, need, ProviderError, refKey, deviceKey, type Dimension, type Provider } from "./types.ts";

type Key = { client_email: string; private_key: string; token_uri?: string };
export type Ga4Config = { key: Key; propertyId: string; propertyName: string };

const DATA = () => process.env.KEEPSTAT_GA4_DATA_API || "https://analyticsdata.googleapis.com/v1beta";
const ADMIN = () => process.env.KEEPSTAT_GA4_ADMIN_API || "https://analyticsadmin.googleapis.com/v1beta";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const cache = new Map<string, { token: string; exp: number }>();

function parseKey(raw: string): Key {
  let k: Key;
  try {
    k = JSON.parse(raw);
  } catch {
    throw new ProviderError(400, "Paste the whole service account key file (it's JSON and starts with {).");
  }
  if (!k?.client_email || !k?.private_key) throw new ProviderError(400, "That JSON isn't a service account key (no client_email / private_key).");
  return { client_email: k.client_email, private_key: k.private_key, token_uri: k.token_uri };
}

async function accessToken(key: Key): Promise<string> {
  const hit = cache.get(key.client_email);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const aud = process.env.KEEPSTAT_GA4_TOKEN_URI || key.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600 }))}`;
  let sig: string;
  try {
    sig = createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url");
  } catch {
    throw new ProviderError(400, "The service account's private key couldn't be read. Paste the key file exactly as downloaded.");
  }
  const r = await getJson<{ access_token: string; expires_in: number }>("Google", aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }).toString(),
    authHint: "Google rejected the service account key. It may have been deleted; create a new key.",
  });
  cache.set(key.client_email, { token: r.access_token, exp: Date.now() + r.expires_in * 1000 });
  return r.access_token;
}

type Report = { rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[]; rowCount?: number };

async function report(cfg: Ga4Config, body: Record<string, unknown>): Promise<Report> {
  return getJson<Report>("Google Analytics", `${DATA()}/properties/${cfg.propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(cfg.key)}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    authHint: `Google Analytics refused access. Add ${cfg.key.client_email} to the property as a Viewer (Admin → Property access management).`,
  });
}

const DIM: Record<Dimension, string> = { requestPath: "pagePath", referrerHostname: "sessionSource", country: "countryId", deviceType: "deviceCategory" };
const gaDate = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

export const ga4: Provider<Ga4Config> = {
  kind: "ga4",
  name: "Google Analytics",
  backfill: [3650, 730],
  refetch: 35,
  breakdowns: "range",
  async options(f) {
    const key = parseKey(need(f, "key", "service account key"));
    const r = await getJson<{ accountSummaries?: { displayName: string; propertySummaries?: { property: string; displayName: string }[] }[] }>(
      "Google Analytics",
      `${ADMIN()}/accountSummaries?pageSize=200`,
      { headers: { Authorization: `Bearer ${await accessToken(key)}` }, authHint: "Google rejected the key. Make sure the Google Analytics Admin and Data APIs are enabled for its project." }
    );
    const out = (r.accountSummaries ?? []).flatMap((a) =>
      (a.propertySummaries ?? []).map((p) => ({ id: JSON.stringify([p.property.split("/")[1], p.displayName]), label: p.displayName, sub: `${a.displayName} · ${p.property.split("/")[1]}` }))
    );
    if (!out.length) throw new ProviderError(404, `No properties yet. In GA4, add ${key.client_email} as a Viewer, then try again.`);
    return out;
  },
  async configure(f, choice) {
    const key = parseKey(need(f, "key", "service account key"));
    let propertyId: string, propertyName: string;
    if (choice) [propertyId, propertyName] = JSON.parse(choice);
    else {
      propertyId = need(f, "property", "GA4 property ID").replace(/\D/g, "");
      propertyName = propertyId;
    }
    const cfg = { key, propertyId, propertyName };
    await report(cfg, { dateRanges: [{ startDate: "7daysAgo", endDate: "today" }], metrics: [{ name: "activeUsers" }], limit: 1 });
    return { cfg, label: `Google Analytics · ${propertyName}` };
  },
  async fetchDaily(cfg, since, until) {
    const r = await report(cfg, {
      dateRanges: [{ startDate: since, endDate: until }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }, { name: "bounceRate" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: 100000,
      keepEmptyRows: false,
    });
    const points = (r.rows ?? []).map((x) => ({
      date: gaDate(x.dimensionValues[0].value),
      visitors: Number(x.metricValues[0].value) || 0,
      pageviews: Number(x.metricValues[1].value) || 0,
      bounce_rate: Math.round(Number(x.metricValues[2].value) * 1000) / 10, // GA gives 0–1
    }));
    return { points, raw: { rowCount: r.rowCount } };
  },
  async fetchBreakdown(cfg, dim, since, until, limit) {
    const r = await report(cfg, {
      dateRanges: [{ startDate: since, endDate: until }],
      dimensions: [{ name: DIM[dim] }],
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit,
    });
    return (r.rows ?? []).map((x) => {
      const raw = x.dimensionValues[0].value;
      const key =
        dim === "referrerHostname" ? refKey(raw) : dim === "deviceType" ? deviceKey(raw) : raw && raw !== "(not set)" ? raw : "(unknown)";
      return { key, visitors: Number(x.metricValues[0].value) || 0, pageviews: Number(x.metricValues[1].value) || 0 };
    });
  },
};

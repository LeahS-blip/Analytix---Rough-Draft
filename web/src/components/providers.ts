/** What the connect dialog shows for each source type (no secrets, safe for the browser). */

export type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "password" | "textarea" | "url";
  placeholder?: string;
  optional?: boolean;
  help?: string;
};

export type ProviderUi = {
  kind: string;
  name: string;
  sub: string;
  color: string;
  fields: FieldDef[];
  /** true = after entering credentials, the user picks a project/site from a list */
  pick?: string;
  steps: { text: string; href?: string; link?: string }[];
  keeps: string;
};

export const PROVIDER_UI: ProviderUi[] = [
  {
    kind: "vercel",
    name: "Vercel",
    sub: "Web Analytics",
    color: "#111317",
    fields: [{ name: "token", label: "Access token", type: "password" }],
    pick: "Project",
    steps: [
      { text: "Make sure Web Analytics is enabled on the project." },
      { text: "Create a token with access to that project's team at", href: "https://vercel.com/account/settings/tokens", link: "vercel.com/account/settings/tokens" },
    ],
    keeps: "Visitors, page views, top pages, referrers, countries, devices. Free plan shows 30 days; KeepStat keeps every day.",
  },
  {
    kind: "plausible",
    name: "Plausible",
    sub: "Stats API",
    color: "#5850EC",
    fields: [
      { name: "key", label: "Stats API key", type: "password" },
      { name: "site", label: "Site domain", placeholder: "example.com" },
      { name: "base", label: "Self-hosted address", type: "url", placeholder: "https://plausible.io", optional: true, help: "Leave empty for plausible.io" },
    ],
    steps: [{ text: "In Plausible: Settings → API keys → New API key (Stats API).", href: "https://plausible.io/settings/api-keys", link: "plausible.io/settings/api-keys" }],
    keeps: "All of your Plausible history (including bounce rate), plus pages, sources, countries and devices every day.",
  },
  {
    kind: "umami",
    name: "Umami",
    sub: "Cloud or self-hosted",
    color: "#2B9348",
    fields: [
      { name: "apiKey", label: "API key (Umami Cloud)", type: "password", optional: true },
      { name: "base", label: "Self-hosted address", type: "url", placeholder: "https://analytics.example.com", optional: true, help: "Leave empty for Umami Cloud" },
      { name: "username", label: "Username (self-hosted)", optional: true },
      { name: "password", label: "Password (self-hosted)", type: "password", optional: true },
    ],
    pick: "Website",
    steps: [{ text: "Umami Cloud: Settings → API keys. Self-hosted: use the address and a login that can view the site." }],
    keeps: "Your full Umami history, plus pages, referrers, countries and devices every day.",
  },
  {
    kind: "cloudflare",
    name: "Cloudflare",
    sub: "Web Analytics",
    color: "#F38020",
    fields: [{ name: "token", label: "API token", type: "password" }],
    pick: "Site",
    steps: [
      { text: "Create a custom token with Account → Account Analytics → Read at", href: "https://dash.cloudflare.com/profile/api-tokens", link: "dash.cloudflare.com/profile/api-tokens" },
    ],
    keeps: "Visits, page views, pages, referrers, countries, devices. Cloudflare keeps about 6 months; KeepStat keeps all of it.",
  },
  {
    kind: "ga4",
    name: "Google Analytics",
    sub: "GA4, service account",
    color: "#E37400",
    fields: [{ name: "key", label: "Service account key (JSON)", type: "textarea", placeholder: '{ "type": "service_account", ... }' }],
    pick: "Property",
    steps: [
      { text: "In Google Cloud, enable the Google Analytics Data API and Admin API, then create a service account and a JSON key.", href: "https://console.cloud.google.com/iam-admin/serviceaccounts", link: "console.cloud.google.com" },
      { text: "In GA4: Admin → Property access management → add the service account's email as a Viewer." },
    ],
    keeps: "Users, page views and bounce rate for your whole GA4 history, plus pages, sources, countries and devices.",
  },
  {
    kind: "github",
    name: "GitHub",
    sub: "Repository traffic",
    color: "#24292F",
    fields: [{ name: "token", label: "Token", type: "password" }],
    pick: "Repository",
    steps: [
      { text: "Create a fine-grained token with Administration: Read on the repo (or a classic token with repo) at", href: "https://github.com/settings/personal-access-tokens", link: "github.com/settings/personal-access-tokens" },
    ],
    keeps: "Repo views, unique visitors, popular pages and referrers. GitHub deletes them after 14 days; KeepStat keeps them.",
  },
  {
    kind: "push",
    name: "Push API",
    sub: "Anything else",
    color: "#F25217",
    fields: [{ name: "label", label: "Name", placeholder: "e.g. My app, Shopify, newsletter", optional: true }],
    steps: [{ text: "KeepStat gives you a key. Send daily numbers from any script, cron job or service with one HTTP request." }],
    keeps: "Whatever you send: visitors, page views, bounce rate, and optional top pages, referrers, countries and devices.",
  },
];

export const providerUi = (kind: string) => PROVIDER_UI.find((p) => p.kind === kind);
export const providerColor = (kind: string) => providerUi(kind)?.color ?? "#8a8f98";
export const providerName = (kind: string) => providerUi(kind)?.name ?? kind;

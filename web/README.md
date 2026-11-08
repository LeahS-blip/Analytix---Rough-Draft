# KeepStat (app)

The real version of the KeepStat prototype: sign up, add a site, bring in history from
Vercel or a CSV/JSON export, and keep it forever.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

Requires Node 22.13+ (uses the built-in `node:sqlite`; Node prints an "experimental" warning, which is expected).
The database lives in `web/data/keepstat.db` (created on first run, gitignored; an older `analytix.db` is used if present).

## What works

| Area | Status |
| --- | --- |
| Landing page (`/`) | The prototype's marketing page; CTAs go to sign-up |
| Accounts | Email + password (scrypt), 30-day httpOnly session cookie |
| Sites | Create, switch, rename, set time zone, delete |
| CSV / JSON import | Auto-detects date, visitors, page views, bounce columns; handles messy dates (`Jun '26`, `8/26`, ISO, US/EU), `15.2k`, `1,234`, `42%`; daily or monthly rows; preview before saving; original file kept as a receipt |
| Vercel | Paste an access token → pick a project → backfills what Vercel still has (tries 2y → 1y → 90d → 30d) → refetches the last 35 days daily. Token is AES-256-GCM encrypted at rest. Uses the official Web Analytics API (`/v1/query/web-analytics/visits/aggregate`). |
| Daily snapshots | In-process scheduler checks hourly, fetches each source once per ~20h. Pause/resume, "Fetch now", per-run log with errors. |
| Dashboard | Overview (KPIs, full-history chart, YoY overlay, provider's-edge marker, coverage grid), Trends (+ YoY table), History (sortable), Snapshots log, Import, Sources, Settings, light/dark |
| Export | Monthly or daily CSV download |

**Not built yet** (shown as "soon" in the UI): screenshot→AI import, Ask AI, Timeline/milestones,
Reports, Google Analytics / Cloudflare / Plausible / Umami / Stripe connectors, billing/plan limits,
password reset, email.

## Configuration (optional `.env.local`)

| Variable | Purpose |
| --- | --- |
| `APP_SECRET` | Key for encrypting source tokens. If unset, a random key is generated once into `data/secret.key` — back it up with the DB, or tokens can't be decrypted. |
| `CRON_SECRET` | Enables `GET /api/cron` (send `Authorization: Bearer <secret>`) for hosts without a long-running process. |
| `KEEPSTAT_DATA_DIR` | Where the SQLite DB lives (default `./data`). |
| `KEEPSTAT_DISABLE_SCHEDULER=1` | Turn off the in-process hourly scheduler. |

## Deploying

SQLite + an in-process scheduler fits a single long-running server (Fly.io, Railway, a VPS)
with a persistent volume for `data/`. For Vercel/serverless, swap `src/lib/db.ts` for Postgres
and call `/api/cron` from Vercel Cron.

## Layout

```
src/lib/        db (schema), auth, data access, parseImport, vercel client, snapshots, scheduler
src/app/api/    route handlers (auth, sites, import, export, sources, vercel, cron)
src/app/app/    dashboard pages  →  src/components/ (Dashboard shell, views, charts)
public/landing.html   marketing page extracted from the prototype
```

# KeepStat (app)

Sign up, add a site, bring in history from Vercel or a CSV/JSON export, and keep it forever.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:3000
```

No database setup needed locally: without `DATABASE_URL` the app uses PGlite (Postgres compiled to
WASM), stored in `web/data/pg/` (gitignored). With `DATABASE_URL` set, it uses that Postgres instead.

## Deploy on Vercel (keepstat.vercel.app)

1. **Build the app, not the files.** Vercel → project → Settings → Build and Deployment →
   **Root Directory: `web`** → Save. (Framework is detected as Next.js from `web/vercel.json`.)
2. **Add the database.** Project → **Storage** → Create Database → **Neon** (free) → connect it to
   this project for all environments. This sets `DATABASE_URL` automatically. Tables are created on
   the first request.
3. **Add two secrets.** Settings → Environment Variables, for Production (and Preview if you use it):
   - `APP_SECRET`: a long random string. Encrypts saved Vercel tokens. Don't change it later, or
     saved tokens can't be read and those sources must be reconnected.
   - `CRON_SECRET`: another long random string. Vercel Cron sends it so only Vercel can trigger
     the daily snapshot.

   Make a random string with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
4. **Redeploy** (Deployments → ⋯ → Redeploy) so the new settings take effect.

The daily snapshot runs at 06:00 UTC via Vercel Cron (`web/vercel.json` → `GET /api/cron`).
Old prototype links (`/Analytix/index.html`) redirect to `/`.

## What works

| Area | Status |
| --- | --- |
| Landing page (`/`) | Marketing page; every "Start free" goes to sign-up |
| Accounts | Email + password (scrypt), 30-day httpOnly session cookie |
| Sites | Create, switch, rename, set time zone, delete |
| CSV / JSON import | Auto-detects date, visitors, page views, bounce columns; handles messy dates (`Jun '26`, `8/26`, ISO, US/EU), `15.2k`, `1,234`, `42%`; daily or monthly rows; preview before saving; original file kept as a receipt |
| Vercel | Paste an access token → pick a project → backfills what Vercel still has (tries 2y → 1y → 90d → 30d) → refetches the last 35 days daily. Token is AES-256-GCM encrypted at rest. Uses the official Web Analytics API (`/v1/query/web-analytics/visits/aggregate`). |
| Daily snapshots | Vercel Cron in production; an hourly in-process check when running on your own machine. Pause/resume, "Fetch now", per-run log with errors. |
| Dashboard | Overview, Trends, History, Snapshots log, Import, Sources, Settings, light/dark |
| Export | Monthly or daily CSV download |

**Not built yet** (shown as "soon" in the UI): screenshot→AI import, Ask AI, Timeline/milestones,
Reports, Google Analytics / Cloudflare / Plausible / Umami / Stripe connectors, billing/plan limits,
password reset, email.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (set by the Neon integration). Unset = local PGlite. |
| `APP_SECRET` | Key for encrypting source tokens. If unset, a random key is generated once and stored in the database. |
| `CRON_SECRET` | Required for `GET /api/cron` (`Authorization: Bearer <secret>`). |
| `KEEPSTAT_DATA_DIR` | Where local PGlite data lives (default `./data`). |
| `KEEPSTAT_DISABLE_SCHEDULER=1` | Turn off the local hourly scheduler. |

## Tests

```bash
node scripts/test-postgres-driver.mjs   # production Postgres driver path, against an in-memory Postgres
node scripts/test-vercel-plan-limit.mjs # fetches shrink to the Vercel plan's allowed range (Hobby: 31 days)
```

## Layout

```
src/lib/        db (schema + Postgres/PGlite), auth, data access, parseImport, vercel client, snapshots
src/app/api/    route handlers (auth, sites, import, export, sources, vercel, cron)
src/app/app/    dashboard pages  →  src/components/ (Dashboard shell, views, charts)
public/landing.html   marketing page
vercel.json     daily cron
```

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
| Screenshot import | Drop, pick or paste (Ctrl+V) a screenshot of any dashboard; the rows go through the same preview as a CSV, so nothing is saved until you confirm. **Without AI** (default): Tesseract text recognition runs in the browser (nothing uploaded); the image is upscaled, greyscaled, dark mode inverted and thresholded; each number is matched to the column heading above it, so a missed cell leaves a gap instead of shifting the row (`src/lib/ocrRows.ts`). Reads tables and lists, not chart lines. **With `ANTHROPIC_API_KEY`**: Claude (`claude-opus-5-5`, structured output) reads any dashboard, including charts (flagged as estimates); falls back to text recognition if the AI call fails. |
| CSV / JSON import | Auto-detects date, visitors, page views, bounce columns; handles messy dates (`Jun '26`, `8/26`, ISO, US/EU), `15.2k`, `1,234`, `42%`; daily or monthly rows; preview before saving; original file kept as a receipt |
| Sources | Backfill what the provider still has, then refetch recent days daily. Credentials are AES-256-GCM encrypted at rest. Each also keeps top pages, referrers, countries and devices per day (`src/lib/providers/`). |
| · Vercel | Access token → project. Web Analytics API; learns the plan limit (Hobby: 31 days). |
| · Plausible | Stats API v2 key + site domain (plausible.io or self-hosted). Full history, with bounce rate. |
| · Umami | Cloud API key, or self-hosted address + login → website. Full history. |
| · Cloudflare | API token (Account Analytics: Read) → Web Analytics site. GraphQL, read a month at a time; ~6 months available. |
| · Google Analytics 4 | Service account JSON key (added to the property as Viewer) → property. Data API; users, page views, bounce rate. |
| · GitHub | Token → repo. Traffic views + popular pages/referrers; GitHub keeps only 14 days, stored as non-overlapping 14-day blocks. |
| · Push API | `POST /api/ingest` with `Authorization: Bearer ks_…` and `{date, visitors, pageviews, bounce_rate, pages, referrers, countries, devices}` or `{rows:[…]}`. Only a SHA-256 of the key is stored. |
| Daily snapshots | Vercel Cron in production; an hourly in-process check when running on your own machine. Pause/resume, "Fetch now", per-run log with errors. |
| Dashboard | Overview (KPIs, history chart, insights, channels, breakdowns), Trends (by the numbers, weekday profile, year over year), Explore, History, Snapshots log, Import, Sources, Settings, light/dark |
| Breakdowns kept | Pages, referrers, countries, devices, browsers, operating systems, UTM sources and campaigns, plus average visit length (Plausible, GA4, push). Each provider gives what it has (GitHub: pages + referrers). |
| Explore | Every page / referrer / country / browser / campaign ever kept, searchable and sortable (all kept, last 30 days, change, first seen, "new"), and each one's day-by-day history, best day and share. Export every breakdown row as CSV. |
| Insights | Spikes and who caused them, week over week, month-end forecast, year over year, new referrers, AI-assistant traffic, channel mix, growth streaks, bounce change, best month, weekday pattern, records |
| Export | Monthly or daily CSV (daily includes average visit seconds), and all breakdowns as CSV |

**Not built yet** (shown as "soon" in the UI): Ask AI, Timeline/milestones,
Reports, Stripe, billing/plan limits, password reset, email.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (set by the Neon integration). Unset = local PGlite. |
| `APP_SECRET` | Key for encrypting source tokens. If unset, a random key is generated once and stored in the database. |
| `CRON_SECRET` | Required for `GET /api/cron` (`Authorization: Bearer <secret>`). |
| `ANTHROPIC_API_KEY` | Optional. Lets screenshot import read charts and messy dashboards with AI. Without it, screenshots are read by text recognition in the browser. |
| `KEEPSTAT_DATA_DIR` | Where local PGlite data lives (default `./data`). |
| `KEEPSTAT_DISABLE_SCHEDULER=1` | Turn off the local hourly scheduler. |

## Tests

```bash
node scripts/test-postgres-driver.mjs   # production Postgres driver path, against an in-memory Postgres
node scripts/test-vercel-plan-limit.mjs # fetches shrink to the Vercel plan's allowed range (Hobby: 31 days)
node scripts/test-ocr-rows.mjs          # screenshot text → rows rules (dates, columns, OCR slips)
node scripts/mock-providers.mjs         # local stand-ins for every provider's API (port 5099); the
                                        # KEEPSTAT_*_API lines to put in .env.local are at the top of the file
node scripts/e2e-providers.mjs          # with the mock + `npm run dev` running: connects every provider,
                                        # refetches, checks bad keys and the push API
```

## Layout

```
src/lib/        db (schema + Postgres/PGlite), auth, data access, parseImport, vercel client, snapshots
src/lib/providers/  one file per connector (plausible, umami, cloudflare, ga4, github) + shared types
src/app/api/    route handlers (auth, sites, import, export, sources, connect, ingest, vercel, cron)
src/app/app/    dashboard pages  →  src/components/ (Dashboard shell, views, charts)
public/landing.html   marketing page
vercel.json     daily cron
```

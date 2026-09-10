# Analytix — Rough Draft

A single-file interactive prototype for **Analytix**: the permanent memory for your website's analytics.
Connect your analytics once, preserve every day forever, and understand what changed.

## What's here

- **`index.html` / `analytix.html`** — the full prototype in one self-contained file (open it in any browser).
  - Opens on the **landing page**; the *Start free* buttons open the working **dashboard**, with a *Back to site* link to return.
  - **Dashboard views:** Overview, Trends, **Timeline** (scrub through your history + auto-detected milestones + your own events with before/after impact), History table, Snapshots, Import (screenshot / CSV / JSON), Sources, **Ask AI**, Reports, Settings.
  - Light + dark themes; all buttons are wired up.

> Figures shown are illustrative sample data for layout — not real analytics.

## Run it

Just open `index.html` in a browser. No build step, no dependencies (fonts load from Google Fonts when online).

## GitHub Pages

This repo includes a GitHub Actions workflow that publishes the `/Analytix` folder to GitHub Pages.

1. In GitHub, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main` (or `master`) and the workflow will deploy the site.

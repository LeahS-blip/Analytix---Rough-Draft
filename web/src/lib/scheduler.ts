import { runDueSources } from "./snapshots";

export function startScheduler() {
  if (process.env.KEEPSTAT_DISABLE_SCHEDULER === "1") return;
  // Serverless (Vercel) has no long-running process: Vercel Cron calls /api/cron instead.
  if (process.env.VERCEL) return;
  const g = globalThis as { __keepstatScheduler?: boolean };
  if (g.__keepstatScheduler) return;
  g.__keepstatScheduler = true;

  const tick = () =>
    runDueSources()
      .then((r) => {
        if (r.ran) console.log(`[keepstat] snapshots: ran ${r.ran}, failed ${r.failed}`);
      })
      .catch((e) => console.error("[keepstat] scheduler error", e));
  setTimeout(tick, 15_000);
  setInterval(tick, 60 * 60 * 1000);
}

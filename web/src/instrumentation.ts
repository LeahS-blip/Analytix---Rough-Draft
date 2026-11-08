/**
 * Starts the in-process daily snapshot scheduler when the Node server boots.
 * It checks hourly and fetches any source that hasn't succeeded in ~20 hours.
 * On serverless hosts, call GET /api/cron (with CRON_SECRET) from a scheduler instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}

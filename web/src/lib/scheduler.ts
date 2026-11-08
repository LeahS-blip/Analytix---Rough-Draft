import { runDueSources } from "./snapshots";

export function startScheduler() {
  if (process.env.ANALYTIX_DISABLE_SCHEDULER === "1") return;
  const g = globalThis as { __analytixScheduler?: boolean };
  if (g.__analytixScheduler) return;
  g.__analytixScheduler = true;

  const tick = () =>
    runDueSources()
      .then((r) => {
        if (r.ran) console.log(`[analytix] snapshots: ran ${r.ran}, failed ${r.failed}`);
      })
      .catch((e) => console.error("[analytix] scheduler error", e));
  setTimeout(tick, 15_000);
  setInterval(tick, 60 * 60 * 1000);
}

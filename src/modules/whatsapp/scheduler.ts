import { initScheduler } from "@/lib/cron";

/** @deprecated The worker lives in lib/cron; retained for the existing server entrypoint. */
export function startScheduler() {
    initScheduler();
}

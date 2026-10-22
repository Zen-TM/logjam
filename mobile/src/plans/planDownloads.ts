// Download for the trip, as the app runs it: one run per plan, outliving the
// plan screen that started it. A second press, or the screen reopened, joins
// the run; its progress is read here (a remounted row shows it); its outcome
// is a toast at the shell (`BackgroundToast.tsx`), wherever the user has got
// to. The download itself, and its stop for the wipe, is `plansCache.ts`.
import { useSyncExternalStore } from "react";
import { messageFromError, TRIP_PLAN_OFFLINE } from "@logjam/shared";

import { NotEnoughSpaceError } from "../offline/freeSpace";
import type { ToastMessage } from "../ui";
import { downloadPlan } from "./plansCache";

export type PlanDownloadProgress = { done: number; total: number };

const runs = new Map<string, Promise<void>>();
const progress = new Map<string, PlanDownloadProgress>();
const listeners = new Set<() => void>();
const toastListeners = new Set<
  (message: Omit<ToastMessage, "nonce">) => void
>();

const notify = () => {
  for (const listener of listeners) listener();
};

/** Start the plan's download, or join the one running. */
export function startPlanDownload(planId: string): Promise<void> {
  const running = runs.get(planId);
  if (running) return running;
  progress.set(planId, { done: 0, total: 0 });
  notify();
  const run = downloadPlan(planId, (done, total) => {
    progress.set(planId, { done, total });
    notify();
  })
    // Stopped by the sign-out wipe: nothing to report, to anyone.
    .then((done) => {
      if (done) toast(TRIP_PLAN_OFFLINE.downloadDone, "info");
    })
    .catch((err: unknown) =>
      toast(
        err instanceof NotEnoughSpaceError
          ? err.message
          : messageFromError(err, TRIP_PLAN_OFFLINE.downloadFailed),
        "error",
      ),
    )
    .finally(() => {
      runs.delete(planId);
      progress.delete(planId);
      notify();
    });
  runs.set(planId, run);
  return run;
}

function toast(text: string, tone: ToastMessage["tone"]) {
  for (const listener of toastListeners) listener({ text, tone });
}

/** A plan's running download, re-rendering the caller as it advances. */
export function usePlanDownload(planId: string): PlanDownloadProgress | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => progress.get(planId) ?? null,
  );
}

/** Subscribe to download outcomes: BackgroundToast, the only consumer. */
export function onPlanDownloadToast(
  listener: (message: Omit<ToastMessage, "nonce">) => void,
): () => void {
  toastListeners.add(listener);
  return () => toastListeners.delete(listener);
}

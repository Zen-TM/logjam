// The one GeoPDF import that may be running, and where the rest of the app
// reads it from.
//
// WHY MODULE STATE AND NOT A SCREEN'S: an import takes minutes, and for all but
// the first couple of seconds of that the JS thread is idle — the native
// rasteriser is doing the work on its own executor. There is no reason to hold
// the user on one screen for it, so the run outlives the screen that started
// it: the Saved list shows a progress card, a toast announces the outcome
// wherever the user has got to, and the import keeps going in between. (The
// screen that started it used to be a full-screen modal for the whole run,
// which is what actually made the app feel frozen for minutes.)
//
// ONE AT A TIME, and the guard lives here rather than in each caller. The
// picker, the account-GeoPDF list, the share sheet and the Wi-Fi auto-download
// can all fire independently; two imports at once would fight over the single
// native executor and, for the same file twice, over the same directory.
//
// PRIVACY: labels are display strings shown in-app. Nothing here logs a file
// name or a path — failures carry the pipeline's static message, error CODES
// only, exactly as the pipeline promises.
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

import type { ToastMessage } from "../ui/Toast";
import type { GeoPdfImportState } from "./geoPdfImportsDb";
import type { GeoPdfImportEstimate } from "@logjam/shared/dist/geoPdfImport/tilePlan.js";

import {
  GEOPDF_ERRORS,
  type GeoPdfCancelToken,
  type GeoPdfImportOutcome,
  type GeoPdfProgress,
} from "./importPipeline";

export type GeoPdfImportRun = {
  label: string;
  phase: GeoPdfImportState;
  /** 0–1 in the measurable phases; null while a phase has no measure. */
  fraction: number | null;
  /** Registry row id once it exists — null through hashing and copying. */
  importId: string | null;
  /** What the run is going to cost, once planning has said. Null before that. */
  estimate: GeoPdfImportEstimate | null;
};

/**
 * What each phase is doing, in the user's terms. "Reading" covers the three
 * front phases at once: they pass in a couple of seconds now that the file no
 * longer travels through the JS heap, and naming them separately would only
 * flicker three labels past too fast to read.
 */
export const GEOPDF_PHASE_LABEL: Record<GeoPdfImportState, string> = {
  copying: "Reading the file",
  hashing: "Reading the file",
  parsing: "Reading the georeferencing",
  planning: "Working out the tiles",
  rasterising: "Rendering the map",
  overviews: "Building the zoomed-out levels",
  finalising: "Finishing up",
  ready: "Done",
  failed: "That didn't work",
};

/**
 * Phases where cancelling actually does something.
 *
 * It used to be the two rasteriser phases only, because the token was read
 * between batches and nowhere else — so a large sheet's parse, plan and copy
 * (the front half, which on a big file is the part that looks hung) offered a
 * button that ignored you. The pipeline now checks the token at each front-phase
 * boundary too. `hashing` stays out: it is a single native call with nothing to
 * interrupt inside it.
 */
export const CANCELLABLE_PHASES: GeoPdfImportState[] = [
  "copying",
  "parsing",
  "planning",
  "rasterising",
  "overviews",
];

let current: (GeoPdfImportRun & { token: GeoPdfCancelToken }) | null = null;
/** Resolves when the run in `current` has finished unwinding — what an
 * account wipe awaits before deleting the directory the run writes into. */
let currentSettled: Promise<void> | null = null;

const runListeners = new Set<() => void>();
const toastListeners = new Set<(message: Omit<ToastMessage, "nonce">) => void>();

function notifyRun(): void {
  for (const listener of runListeners) listener();
}

function emitToast(text: string, tone: ToastMessage["tone"]): void {
  for (const listener of toastListeners) listener({ text, tone });
}

function subscribeRun(listener: () => void): () => void {
  runListeners.add(listener);
  return () => runListeners.delete(listener);
}

export function getGeoPdfImportRun(): GeoPdfImportRun | null {
  return current;
}

/** Subscribe to import outcomes — see GeoPdfImportToast, the only consumer. */
export function onGeoPdfImportToast(
  listener: (message: Omit<ToastMessage, "nonce">) => void,
): () => void {
  toastListeners.add(listener);
  return () => toastListeners.delete(listener);
}

/** The running import, re-rendering the caller as it advances. */
export function useGeoPdfImportRun(): GeoPdfImportRun | null {
  return useSyncExternalStore(subscribeRun, getGeoPdfImportRun);
}

export function isGeoPdfImportRunning(): boolean {
  return current !== null;
}

/**
 * Ask the running import to stop at the next batch boundary. It pauses rather
 * than aborts — the partial MBTiles carries its own checkpoint, so Saved offers
 * Resume and no rendered tile is thrown away.
 */
export function cancelGeoPdfImportRun(): void {
  if (current) current.token.cancelled = true;
}

/**
 * Cancel and WAIT — the account-transition contract, called by
 * `wipeAllLocalData` before it deletes anything.
 *
 * An import still unwinding while the wipe ran re-created `imports/geopdf/`
 * and re-registered its row after the wipe reported success, and `current`'s
 * label (a map sheet name) outlived the sign-out for the life of the JS
 * context. Cancelling alone doesn't fix either: cancellation lands at the next
 * rasteriser batch, and the caller has to know when that has happened.
 */
export async function stopGeoPdfImportRun(): Promise<void> {
  if (!current) return;
  current.token.cancelled = true;
  await currentSettled;
}

/**
 * Run an import in the background. Resolves when it finishes; the outcome is
 * announced by toast, so callers that only want it started can ignore the
 * promise. Never rejects — a failed import is a toast, not an unhandled
 * rejection in whichever screen happened to start it.
 */
export async function runGeoPdfImport(
  label: string,
  start: (
    onProgress: (progress: GeoPdfProgress) => void,
    token: GeoPdfCancelToken,
  ) => Promise<GeoPdfImportOutcome>,
): Promise<GeoPdfImportOutcome | null> {
  if (current) {
    emitToast("One GeoPDF is already importing — this one can wait.", "error");
    return null;
  }
  const token: GeoPdfCancelToken = { cancelled: false };
  current = {
    label,
    phase: "hashing",
    fraction: null,
    importId: null,
    estimate: null,
    token,
  };
  let markSettled = (): void => {};
  currentSettled = new Promise<void>((resolve) => {
    markSettled = resolve;
  });
  notifyRun();

  // Measures what the user actually feels: the longest the JS thread went
  // without servicing a timer. Attributing a freeze from step durations alone
  // is guesswork — a slow step that yields is fine, a fast one that doesn't
  // isn't. Logged once per import, a number and nothing else.
  //
  // ONLY FOREGROUND TIME COUNTS. Android stops a backgrounded app's timers, and
  // the document picker is a different activity, so the gap while the user
  // chooses a file is a gap in the MEASUREMENT, not a freeze — uncorrected it
  // reported a 50-second stall on an 11-second import.
  //
  // The correction has to come from an AppState listener rather than a check
  // inside the tick: while the app is backgrounded the tick does not run at
  // all, so it can never observe the transition it needs to skip. Every
  // transition also restarts the interval, so the first tick after a resume
  // measures from the resume and not from whenever the app went away.
  const HEARTBEAT_MS = 100;
  let lastBeat = Date.now();
  let foreground = AppState.currentState === "active";
  let worstStallMs = 0;
  const appStateSubscription = AppState.addEventListener("change", (state) => {
    foreground = state === "active";
    lastBeat = Date.now();
  });
  const heartbeat = setInterval(() => {
    const now = Date.now();
    if (foreground) {
      worstStallMs = Math.max(worstStallMs, now - lastBeat - HEARTBEAT_MS);
    }
    lastBeat = now;
  }, HEARTBEAT_MS);

  const onProgress = (progress: GeoPdfProgress) => {
    if (!current) return;
    const measurable =
      progress.phase === "rasterising" || progress.phase === "overviews";
    current = {
      ...current,
      phase: progress.phase,
      fraction: measurable ? progress.fraction : null,
      importId: progress.importId ?? current.importId,
      estimate: progress.estimate ?? current.estimate,
      // The picker can't name the file until the user has chosen one, so the
      // card opens on whatever the caller guessed and takes the real name here.
      label: progress.label ?? current.label,
    };
    notifyRun();
  };

  try {
    const outcome = await start(onProgress, token);
    // The live label, not the one this started with — by now the picker has
    // told us the file's actual name, and the toast is the last place the user
    // hears about it.
    const named = current?.label ?? label;
    switch (outcome.status) {
      case "imported":
        emitToast(`${named} imported.`, "info");
        break;
      case "existing":
        emitToast(`${named} was already imported.`, "info");
        break;
      case "paused":
        emitToast("Import paused — resume it from Saved.", "info");
        break;
      case "cancelled":
        break;
    }
    return outcome;
  } catch (err) {
    console.error(err);
    const code = (err as { code?: string }).code;
    emitToast(
      (code && GEOPDF_ERRORS[code]) ||
        (err instanceof Error && err.message) ||
        "Couldn't import that PDF.",
      "error",
    );
    return null;
  } finally {
    clearInterval(heartbeat);
    appStateSubscription.remove();
    console.log(`[geopdf] worst JS-thread stall ${worstStallMs} ms`);
    current = null;
    currentSettled = null;
    markSettled();
    notifyRun();
  }
}

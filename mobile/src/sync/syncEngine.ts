// Sync cycle orchestration (stage8-sync.md §2, §8.3): cycle = push (outbox
// flush — lands in the outbox phase of PR-5) then pull (delta). Triggers:
// app foreground while online, connectivity regained, debounced after local
// mutation, manual pull-to-refresh. NEVER a background timer — battery is a
// field resource.
import { AppState } from "react-native";
import { computeBackoffMs } from "@logjam/shared";

import { subscribeReconnect } from "../map/connectivity";

import { fetchCurrentUser } from "../api/queries";
import { canRunNow } from "../offline/networkPolicy";
import { runDeltaPull, SyncApplyError } from "./deltaPull";
import { flushOutbox } from "./flush";
import { syncThumbnailCache } from "./mediaCache";
import { setMutationSyncHandler } from "./mediaSyncBridge";
import {
  clearSyncStateValue,
  getSyncStateValue,
  setSyncStateValue,
} from "./syncDb";

/**
 * Why the last cycle failed. `unreachable` is the network — offline, a 5xx, an
 * expired token — and a retry is a real promise. `applyFailed` is the server
 * answering fine and THIS APP failing to apply what it sent: a retry re-fetches
 * the same page and fails identically, so the copy must not blame the link or
 * promise a retry, and the failure has to reach the screen built to list sync
 * problems instead of hiding behind a self-healing message.
 */
export type SyncErrorKind = "unreachable" | "applyFailed";

export type SyncStatus = {
  state: "idle" | "syncing" | "error";
  /** ISO instant of the last successful cycle, null before first sync. */
  lastSyncAt: string | null;
  /** User-safe message for the error state (no row contents). */
  errorMessage: string | null;
  errorKind: SyncErrorKind | null;
};

let status: SyncStatus = {
  state: "idle",
  lastSyncAt: null,
  errorMessage: null,
  errorKind: null,
};
const statusListeners = new Set<(status: SyncStatus) => void>();

export function getSyncStatus(): SyncStatus {
  return status;
}

export function onSyncStatusChanged(
  listener: (status: SyncStatus) => void,
): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function setStatus(next: Partial<SyncStatus>): void {
  status = { ...status, ...next };
  for (const listener of statusListeners) listener(status);
}

// The mirror needs the account's user id to shape share rows (direction /
// counterpart). Resolved online once and persisted, so offline cycles (and
// offline app starts) never block on /users/me.
async function resolveCurrentUserId(): Promise<string> {
  const persisted = await getSyncStateValue("userId");
  if (persisted) return persisted;
  const user = await fetchCurrentUser();
  await setSyncStateValue("userId", user.id);
  return user.id;
}

// One cycle at a time; a trigger during a running cycle queues exactly one
// follow-up (coalesced — ten triggers still mean one more cycle).
let running: Promise<void> | null = null;
let followUpRequested = false;

async function runCycleOnce(): Promise<void> {
  const userId = await resolveCurrentUserId();
  // Cycle order (§2): push then pull, so the pull's rebase sees post-flush
  // server state and just-created rows come back confirmed.
  //
  // The pull runs even when the push failed. One unsendable op — a media file
  // the OS reclaimed, say, which throws with no HTTP status and so is never
  // parked — used to abort the cycle before the pull and stop the mirror
  // receiving ANY server change, for as long as that op sat in the outbox.
  // Push failure is still a cycle failure; it just isn't a pull failure.
  let flushError: unknown = null;
  try {
    await flushOutbox();
  } catch (err) {
    flushError = err;
  }
  await runDeltaPull(userId);
  if (flushError) throw flushError;
  // Eager thumbnail cache (§7.3): best-effort — an offline-again failure
  // must not mark the whole cycle failed (rows retry next pass).
  await syncThumbnailCache().catch(() => {});
  retryAttempt = 0;
  await clearSyncStateValue(APPLY_FAILED_KEY);
  setStatus({
    state: "idle",
    lastSyncAt: new Date().toISOString(),
    errorMessage: null,
    errorKind: null,
  });
}

/** sync_state key recording an unapplicable delta page, so the failure
 * survives a restart and can be counted as a sync issue. */
export const APPLY_FAILED_KEY = "applyFailedAt";

export function requestSync(): Promise<void> {
  if (running) {
    followUpRequested = true;
    return running;
  }
  // Triggers are unregistered but an in-flight promise can still resolve into
  // one: refuse to start after the shell handed the engine back.
  if (stopped) return Promise.resolve();
  setStatus({ state: "syncing", errorMessage: null, errorKind: null });
  running = (async () => {
    try {
      await runCycleOnce();
      while (followUpRequested) {
        followUpRequested = false;
        await runCycleOnce();
      }
    } catch (err) {
      followUpRequested = false;
      if (err instanceof SyncApplyError) {
        // Nothing about waiting changes the outcome, so do not schedule a
        // retry the user is then told about. The recovery is a fresh mirror
        // (or a new app version), offered from Sync issues.
        console.error("sync: delta page could not be applied", err.cause);
        await setSyncStateValue(APPLY_FAILED_KEY, new Date().toISOString()).catch(
          () => {},
        );
        setStatus({
          state: "error",
          errorMessage: "This phone couldn't apply an update.",
          errorKind: "applyFailed",
        });
        return;
      }
      // Offline or server trouble: quiet failure — the mirror keeps serving.
      // Exponential-backoff retry (§8.3, 1 s..5 min jitter) on top of the
      // event triggers, so a flaky link recovers without user action.
      setStatus({
        state: "error",
        errorMessage: "Couldn't sync. Will retry.",
        errorKind: "unreachable",
      });
      scheduleBackoffRetry();
    } finally {
      running = null;
    }
  })();
  return running;
}

let retryAttempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** Set by the trigger cleanup: no cycle and no timer may outlive sign-out. */
let stopped = false;

function scheduleBackoffRetry(): void {
  // A cycle already in flight when the shell unmounted still lands here on
  // failure, and used to install a fresh timer AFTER the cleanup ran — a
  // self-sustaining loop issuing authenticated requests with no owner and no
  // way to stop it short of a process restart.
  if (stopped || retryTimer) return;
  const delay = computeBackoffMs(retryAttempt);
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void requestSync();
  }, delay);
}

// ── debounced local-mutation trigger (§2) ────────────────────────────────────

const MUTATION_SYNC_DEBOUNCE_MS = 10_000;
let mutationTimer: ReturnType<typeof setTimeout> | null = null;

/** Called by the outbox after every enqueue: one cycle fires 10 s after the
 * LAST local edit, so a burst of field edits flushes as one batch. */
export function scheduleMutationSync(): void {
  if (mutationTimer) clearTimeout(mutationTimer);
  mutationTimer = setTimeout(() => {
    mutationTimer = null;
    // Unasked, so it answers to the same connection policy as the other
    // automatic triggers; the work stays in the outbox until one is allowed.
    // NOT through `requestAutoSync`: this trigger is already debounced by ten
    // seconds of quiet, and putting it behind the shared rate limit as well
    // would silently drop the flush of an edit made just after a foreground
    // cycle.
    void canRunNow("sync").then((allowed) => {
      if (allowed) void requestSync();
    });
  }, MUTATION_SYNC_DEBOUNCE_MS);
}

// ── triggers ─────────────────────────────────────────────────────────────────

/** Minimum gap between automatic (non-manual) trigger firings. */
const AUTO_SYNC_MIN_INTERVAL_MS = 10_000;
let lastAutoSyncAt = 0;

/**
 * An UNASKED cycle. Everything the user asks for by hand goes through
 * `requestSync` directly and is never gated — tapping "Sync now" on mobile data
 * is the user saying they want it on mobile data, and a button that silently
 * declines is worse than no button.
 *
 * Sync defaults to allowed on mobile data (`networkPolicy.ts`): a cycle is a
 * few kilobytes of JSON, and a trip log that waits for Wi-Fi is a trip log that
 * exists on one phone for the week it matters. The switch is for people
 * roaming or on a hard cap.
 */
function requestAutoSync(): void {
  const now = Date.now();
  if (now - lastAutoSyncAt < AUTO_SYNC_MIN_INTERVAL_MS) return;
  lastAutoSyncAt = now;
  void canRunNow("sync").then((allowed) => {
    if (allowed) void requestSync();
  });
}

/**
 * Wire the automatic sync triggers. Call once from the authenticated shell;
 * returns a cleanup for sign-out.
 */
export function registerSyncTriggers(): () => void {
  // A previous registration's cleanup left the engine stopped; a fresh sign-in
  // starts from clean module state rather than inheriting the old one's.
  stopped = false;
  retryAttempt = 0;
  lastAutoSyncAt = 0;
  followUpRequested = false;

  // Wire the post-enqueue trigger (outbox + media paths call it via the
  // bridge), then run the one-time Stage 7 → Stage 8 promotion of legacy
  // local-only waypoints into the synced mirror (best-effort; retried next
  // launch on failure).
  setMutationSyncHandler(scheduleMutationSync);
  void import("./outbox")
    .then((outbox) => outbox.migrateLegacyWaypoints())
    .catch(() => {});

  // App returns to foreground.
  const appStateSub = AppState.addEventListener("change", (state) => {
    if (state === "active") requestAutoSync();
  });

  // Connectivity regained (edge-triggered: offline → online).
  const netInfoUnsub = subscribeReconnect(requestAutoSync);

  // Initial cycle on registration (fresh sign-in / app start).
  requestAutoSync();

  return () => {
    stopped = true;
    followUpRequested = false;
    setMutationSyncHandler(null);
    appStateSub.remove();
    netInfoUnsub();
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (mutationTimer) {
      clearTimeout(mutationTimer);
      mutationTimer = null;
    }
  };
}

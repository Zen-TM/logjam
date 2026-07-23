// Sync cycle orchestration (stage8-sync.md §2, §8.3): cycle = push (outbox
// flush — lands in the outbox phase of PR-5) then pull (delta). Triggers:
// app foreground while online, connectivity regained, debounced after local
// mutation, manual pull-to-refresh. NEVER a background timer — battery is a
// field resource.
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import { fetchCurrentUser } from "../api/queries";
import { runDeltaPull } from "./deltaPull";
import { getSyncStateValue, setSyncStateValue } from "./syncDb";

export type SyncStatus = {
  state: "idle" | "syncing" | "error";
  /** ISO instant of the last successful cycle, null before first sync. */
  lastSyncAt: string | null;
  /** User-safe message for the error state (no row contents). */
  errorMessage: string | null;
};

let status: SyncStatus = { state: "idle", lastSyncAt: null, errorMessage: null };
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
  // TODO(PR-5 outbox phase): flush the outbox here, BEFORE the pull, so the
  // pull's rebase sees post-flush server state (§2 cycle order).
  await runDeltaPull(userId);
  setStatus({
    state: "idle",
    lastSyncAt: new Date().toISOString(),
    errorMessage: null,
  });
}

export function requestSync(): Promise<void> {
  if (running) {
    followUpRequested = true;
    return running;
  }
  setStatus({ state: "syncing", errorMessage: null });
  running = (async () => {
    try {
      await runCycleOnce();
      while (followUpRequested) {
        followUpRequested = false;
        await runCycleOnce();
      }
    } catch {
      // Offline or server trouble: quiet failure — the mirror keeps serving
      // and the next trigger retries. No row contents in the message.
      followUpRequested = false;
      setStatus({ state: "error", errorMessage: "Couldn't sync. Will retry." });
    } finally {
      running = null;
    }
  })();
  return running;
}

// ── triggers ─────────────────────────────────────────────────────────────────

/** Minimum gap between automatic (non-manual) trigger firings. */
const AUTO_SYNC_MIN_INTERVAL_MS = 10_000;
let lastAutoSyncAt = 0;

function requestAutoSync(): void {
  const now = Date.now();
  if (now - lastAutoSyncAt < AUTO_SYNC_MIN_INTERVAL_MS) return;
  lastAutoSyncAt = now;
  void requestSync();
}

/**
 * Wire the automatic sync triggers. Call once from the authenticated shell;
 * returns a cleanup for sign-out.
 */
export function registerSyncTriggers(): () => void {
  // App returns to foreground.
  const appStateSub = AppState.addEventListener("change", (state) => {
    if (state === "active") requestAutoSync();
  });

  // Connectivity regained (edge-triggered: offline → online).
  let wasConnected: boolean | null = null;
  const netInfoUnsub = NetInfo.addEventListener((netState) => {
    const connected = netState.isConnected === true;
    if (connected && wasConnected === false) requestAutoSync();
    wasConnected = connected;
  });

  // Initial cycle on registration (fresh sign-in / app start).
  requestAutoSync();

  return () => {
    appStateSub.remove();
    netInfoUnsub();
  };
}

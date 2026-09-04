import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@logjam/shared";

// Two lifecycle bugs, both of which only appear when a cycle FAILS:
//
//  - a cycle already in flight when the shell unmounts lands in the catch,
//    schedules a backoff retry AFTER the cleanup ran, fails again (no session)
//    and schedules again — authenticated requests forever, with no owner and no
//    way to stop it short of a process restart;
//  - a page the app cannot APPLY was reported as an unreachable account with a
//    promise to keep retrying, which is two lies and a retry storm.

class ApplyError extends Error {
  constructor() {
    super("apply failed");
    this.name = "SyncApplyError";
  }
}

let pullError: Error | null = null;
let pulls = 0;
const stateWrites: Record<string, string> = {};

// `currentState` is load-bearing: the backoff ladder only re-arms in the
// foreground (a backgrounded phone with no signal was retrying every few
// minutes all day, waking the radio to fail).
const appState = { currentState: "active" as string };
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: () => ({ remove: () => {} }),
    get currentState() {
      return appState.currentState;
    },
  },
}));
vi.mock("../map/connectivity", () => ({ subscribeReconnect: () => () => {} }));
vi.mock("../api/queries", () => ({
  fetchCurrentUser: () => Promise.resolve({ id: "user-1" }),
}));
vi.mock("../offline/networkPolicy", () => ({ canRunNow: () => Promise.resolve(true) }));
// The flush reports what it left behind; a pass with nothing retrying is the
// ordinary case and the one these tests are about.
vi.mock("./flush", () => ({ flushOutbox: () => Promise.resolve({ retrying: 0 }) }));
vi.mock("./mediaCache", () => ({ syncThumbnailCache: () => Promise.resolve() }));
// The cycle registers any recording that owes a backup before it flushes. Stubbed
// here for the same reason the media cache is: the real module reaches the
// filesystem, and what this suite tests is the cycle's ORDER and its backoff.
vi.mock("../tracks/trackBackup", () => ({
  sweepTrackBackups: () => Promise.resolve(0),
}));
vi.mock("./mediaSyncBridge", () => ({ setMutationSyncHandler: () => {} }));
vi.mock("./outbox", () => ({ migrateLegacyWaypoints: () => Promise.resolve() }));
vi.mock("./deltaPull", () => ({
  SyncApplyError: ApplyError,
  runDeltaPull: () => {
    pulls += 1;
    return pullError ? Promise.reject(pullError) : Promise.resolve({ pages: 1 });
  },
}));
vi.mock("./syncDb", () => ({
  APPLY_FAILED_KEY: "applyFailedAt",
  getSyncStateValue: (key: string) => Promise.resolve(stateWrites[key] ?? "user-1"),
  setSyncStateValue: (key: string, value: string) => {
    stateWrites[key] = value;
    return Promise.resolve();
  },
  clearSyncStateValue: (key: string) => {
    delete stateWrites[key];
    return Promise.resolve();
  },
}));

const { APPLY_FAILED_KEY, getSyncStatus, registerSyncTriggers, requestSync } =
  await import("./syncEngine");

/** Let the engine's promise chain settle without waiting on real timers. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  appState.currentState = "active";
  pullError = null;
  pulls = 0;
  delete stateWrites[APPLY_FAILED_KEY];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("failure classification", () => {
  it("calls a network failure unreachable and retries it", async () => {
    const stop = registerSyncTriggers();
    pullError = new Error("Network request failed");
    await settle();
    expect(getSyncStatus().errorKind).toBe("unreachable");
    expect(getSyncStatus().errorMessage).toContain("retry");

    const before = pulls;
    await vi.advanceTimersByTimeAsync(400_000);
    expect(pulls).toBeGreaterThan(before);
    stop();
  });

  it("does not arm the retry ladder while backgrounded", async () => {
    // The foreground edge and the reconnect edge both re-trigger a cycle, so a
    // ladder running behind a dark screen can only wake the radio to fail —
    // once every few minutes, for a whole trip, on the recorder's foreground
    // service keeping the process alive.
    appState.currentState = "background";
    const stop = registerSyncTriggers();
    pullError = new Error("Network request failed");
    await settle();
    expect(getSyncStatus().errorKind).toBe("unreachable");

    const before = pulls;
    await vi.advanceTimersByTimeAsync(400_000);
    expect(pulls).toBe(before);
    stop();
  });

  it("calls a local apply failure what it is, and does NOT retry it", async () => {
    const stop = registerSyncTriggers();
    pullError = new ApplyError();
    await settle();

    expect(getSyncStatus().errorKind).toBe("applyFailed");
    expect(getSyncStatus().errorMessage).not.toMatch(/reach/i);
    // Retrying re-fetches the same page and fails the same way; the recovery is
    // a fresh mirror, offered from Sync issues.
    expect(stateWrites[APPLY_FAILED_KEY]).toBeDefined();

    const before = pulls;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(pulls).toBe(before);
    stop();
  });

  it("stops retrying when the server has no sync endpoints", async () => {
    // The field case: the deployed API predated /sync, so every cycle drew a
    // 404 and the ladder kept climbing — 166 of one day's 284 requests were
    // this, each a radio wakeup, under a status line promising a retry.
    const stop = registerSyncTriggers();
    pullError = new ApiError(404, "/sync/delta", "GET");
    await settle();

    expect(getSyncStatus().errorKind).toBe("unsupported");
    expect(getSyncStatus().errorMessage).not.toMatch(/retry/i);

    const before = pulls;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(pulls).toBe(before);
    stop();
  });

  it("still treats a 5xx as unreachable and retries it", async () => {
    // Guard the boundary of the branch above: only 404 means "no such route".
    const stop = registerSyncTriggers();
    pullError = new ApiError(503, "/sync/delta", "GET");
    await settle();
    expect(getSyncStatus().errorKind).toBe("unreachable");

    const before = pulls;
    await vi.advanceTimersByTimeAsync(400_000);
    expect(pulls).toBeGreaterThan(before);
    stop();
  });

  it("clears the marker once a cycle succeeds", async () => {
    stateWrites[APPLY_FAILED_KEY] = "2026-08-13T00:00:00.000Z";
    const stop = registerSyncTriggers();
    await settle();
    expect(getSyncStatus().state).toBe("idle");
    expect(stateWrites[APPLY_FAILED_KEY]).toBeUndefined();
    stop();
  });
});

describe("stopping", () => {
  it("does not start a cycle after the shell handed the engine back", async () => {
    const stop = registerSyncTriggers();
    await settle();
    stop();

    const before = pulls;
    await requestSync();
    await settle();
    expect(pulls).toBe(before);
  });

  it("does not let an in-flight failure resurrect the retry loop", async () => {
    // The window: the cycle is running when the user signs out, so cleanup has
    // already cleared the timer by the time the failure schedules a new one.
    const stop = registerSyncTriggers();
    pullError = new Error("offline");
    stop();
    await settle();

    const before = pulls;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(pulls).toBe(before);
  });
});

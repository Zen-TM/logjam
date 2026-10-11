import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, SYNC_GIVE_UP_AFTER_MS } from "@logjam/shared";

import { markNoResponse } from "../api/noResponse";

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
/** What the phone says about its own link. */
let reachable = true;
vi.mock("../map/connectivity", () => ({
  subscribeReconnect: () => () => {},
  isReachableNow: () => Promise.resolve(reachable),
}));
// Who the server says is signed in. `null` = /users/me fails (offline).
let serverUserId: string | null = "user-1";
let mirrorClears = 0;
vi.mock("../api/queries", () => ({
  fetchCurrentUser: () =>
    serverUserId === null
      ? Promise.reject(new Error("Network request failed"))
      : Promise.resolve({ id: serverUserId }),
}));
vi.mock("../offline/networkPolicy", () => ({
  canRunNow: () => Promise.resolve(true),
}));
// The flush reports what it left behind; a pass with nothing retrying is the
// ordinary case and the one these tests are about.
let flushError: unknown = null;
vi.mock("./flush", () => ({
  flushOutbox: () =>
    flushError ? Promise.reject(flushError) : Promise.resolve({ retrying: 0 }),
}));
vi.mock("./mediaCache", () => ({
  syncThumbnailCache: () => Promise.resolve(),
}));
// The cycle registers any recording that owes a backup before it flushes. Stubbed
// here for the same reason the media cache is: the real module reaches the
// filesystem, and what this suite tests is the cycle's ORDER and its backoff.
vi.mock("../tracks/trackBackup", () => ({
  sweepTrackBackups: () => Promise.resolve(0),
}));
vi.mock("./mediaSyncBridge", () => ({ setMutationSyncHandler: () => {} }));
vi.mock("./outbox", () => ({
  migrateLegacyWaypoints: () => Promise.resolve(),
}));
vi.mock("./deltaPull", () => ({
  SyncApplyError: ApplyError,
  runDeltaPull: () => {
    pulls += 1;
    return pullError
      ? Promise.reject(pullError)
      : Promise.resolve({ pages: 1 });
  },
}));
vi.mock("./syncDb", () => ({
  APPLY_FAILED_KEY: "applyFailedAt",
  clearMirror: () => {
    mirrorClears += 1;
    return Promise.resolve();
  },
  getSyncStateValue: (key: string) =>
    Promise.resolve(stateWrites[key] ?? "user-1"),
  setSyncStateValue: (key: string, value: string) => {
    stateWrites[key] = value;
    return Promise.resolve();
  },
  clearSyncStateValue: (key: string) => {
    delete stateWrites[key];
    return Promise.resolve();
  },
}));

const {
  APPLY_FAILED_KEY,
  UNANSWERED_KEY,
  getSyncStatus,
  registerSyncTriggers,
  requestSync,
} = await import("./syncEngine");

/** Let the engine's promise chain settle without waiting on real timers. */
async function settle(): Promise<void> {
  for (let i = 0; i < 24; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  appState.currentState = "active";
  pullError = null;
  flushError = null;
  reachable = true;
  delete stateWrites[UNANSWERED_KEY];
  pulls = 0;
  delete stateWrites[APPLY_FAILED_KEY];
  serverUserId = "user-1";
  mirrorClears = 0;
  stateWrites.userId = "user-1";
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

// An op that only ever gets no answer is never parked (flush.ts), so the
// status line is the one place that can say the queue has stopped moving. The
// clock it runs on is time this phone called itself online with Logjam GPS in
// front of someone: a week in a canyon is not a fault to report.
describe("changes waiting with no answer", () => {
  const DAY_AND_A_BIT = SYNC_GIVE_UP_AFTER_MS + 30 * 60_000;

  it("says so after a day of unanswered sends, online and in the foreground", async () => {
    vi.setSystemTime(new Date("2026-10-06T02:00:00.000Z"));
    const stop = registerSyncTriggers();
    flushError = markNoResponse(new TypeError("Network request failed"));
    await requestSync();
    await vi.advanceTimersByTimeAsync(SYNC_GIVE_UP_AFTER_MS - 60 * 60_000);
    expect(getSyncStatus().waitingSince).toBeNull();

    await vi.advanceTimersByTimeAsync(90 * 60_000);
    expect(getSyncStatus().waitingSince).toBe("2026-10-06T02:00:00.000Z");
    stop();
  });

  it("does not count time the phone called itself offline", async () => {
    // Mutation: drop the `isReachableNow` check in noteUnanswered.
    reachable = false;
    const stop = registerSyncTriggers();
    flushError = markNoResponse(new TypeError("Network request failed"));
    await requestSync();
    await vi.advanceTimersByTimeAsync(DAY_AND_A_BIT);
    expect(getSyncStatus().waitingSince).toBeNull();
    stop();
  });

  it("does not count time behind a dark screen", async () => {
    // No ladder runs in the background (ADR 0013), so the next failure comes
    // a day later, from the foreground edge. Mutation: add the whole gap
    // between two failures instead of capping it.
    const stop = registerSyncTriggers();
    flushError = markNoResponse(new TypeError("Network request failed"));
    appState.currentState = "background";
    await requestSync();
    await vi.advanceTimersByTimeAsync(DAY_AND_A_BIT);
    appState.currentState = "active";
    await requestSync();
    await settle();
    expect(getSyncStatus().waitingSince).toBeNull();
    stop();
  });

  it("does not count a failure the server answered", async () => {
    // An answered refusal has its own road to the user: the per-op tally.
    const stop = registerSyncTriggers();
    flushError = new ApiError(503, "/sync/push", "POST");
    await requestSync();
    await vi.advanceTimersByTimeAsync(DAY_AND_A_BIT);
    expect(getSyncStatus().waitingSince).toBeNull();
    stop();
  });

  it("keeps the count across a restart, and drops it at the first answer", async () => {
    stateWrites[UNANSWERED_KEY] = JSON.stringify({
      ms: SYNC_GIVE_UP_AFTER_MS,
      since: "2026-10-06T02:00:00.000Z",
    });
    const stop = registerSyncTriggers();
    flushError = markNoResponse(new TypeError("Network request failed"));
    await requestSync();
    await settle();
    expect(getSyncStatus().waitingSince).toBe("2026-10-06T02:00:00.000Z");

    flushError = null;
    await requestSync();
    await settle();
    expect(getSyncStatus().waitingSince).toBeNull();
    expect(stateWrites[UNANSWERED_KEY]).toBeUndefined();
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

// The persisted user id shapes every share row's direction and counterpart. It
// was resolved once and trusted forever, so a stale one (found on a fake-auth
// Pixel holding bob's id while signed in as alice) inverted every share.
describe("persisted user id", () => {
  it("rebuilds the mirror when the account no longer matches it", async () => {
    serverUserId = "user-2";
    const stop = registerSyncTriggers();
    await settle();
    expect(mirrorClears).toBe(1);
    expect(stateWrites.userId).toBe("user-2");
    expect(pulls).toBeGreaterThan(0);
    stop();
  });

  it("leaves a matching mirror alone", async () => {
    const stop = registerSyncTriggers();
    await settle();
    expect(mirrorClears).toBe(0);
    expect(stateWrites.userId).toBe("user-1");
    stop();
  });

  it("keeps the persisted id when the server cannot answer", async () => {
    serverUserId = null;
    const stop = registerSyncTriggers();
    await settle();
    expect(mirrorClears).toBe(0);
    expect(stateWrites.userId).toBe("user-1");
    stop();
  });
});

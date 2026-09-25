import { describe, expect, it } from "vitest";

import { relativeTime, syncHealth, type SyncHealthInput } from "./syncHealth";

const NOW = Date.parse("2026-07-30T10:00:00.000Z");

function input(overrides: Partial<SyncHealthInput> = {}): SyncHealthInput {
  return {
    online: true,
    state: "idle",
    lastSyncAt: "2026-07-30T09:58:00.000Z",
    pendingCount: 0,
    issueCount: 0,
    now: NOW,
    ...overrides,
  };
}

describe("relativeTime", () => {
  it("is coarse, and stops at days", () => {
    expect(relativeTime("2026-07-30T09:59:30.000Z", NOW)).toBe("just now");
    expect(relativeTime("2026-07-30T09:45:00.000Z", NOW)).toBe("15 min ago");
    expect(relativeTime("2026-07-30T09:00:00.000Z", NOW)).toBe("1 hour ago");
    expect(relativeTime("2026-07-30T05:00:00.000Z", NOW)).toBe("5 hours ago");
    expect(relativeTime("2026-07-29T09:00:00.000Z", NOW)).toBe("yesterday");
    expect(relativeTime("2026-07-24T09:00:00.000Z", NOW)).toBe("6 days ago");
  });

  it("never counts forwards from a jumped clock", () => {
    // A timezone change or NTP correction must not render "in -3 minutes".
    expect(relativeTime("2026-07-30T10:05:00.000Z", NOW)).toBe("just now");
  });

  it("does not pretend to know an unparseable instant", () => {
    expect(relativeTime("not a date", NOW)).toBe("at an unknown time");
  });
});

describe("syncHealth", () => {
  it("reports a clean queue", () => {
    const health = syncHealth(input());
    expect(health).toEqual({
      headline: "Everything's synced",
      detail: "Last synced 2 min ago.",
      tone: "ok",
    });
  });

  it("treats offline with an empty outbox as fine, not as a warning", () => {
    // The whole app is built to work with no signal; a scary tone here would
    // train the user to ignore the one that matters.
    const health = syncHealth(input({ online: false }));
    expect(health.tone).toBe("ok");
    expect(health.headline).toBe("Everything's synced");
    expect(health.detail).toBe("You're offline, and nothing is waiting.");
  });

  it("promises signal, not progress, while offline with a queue", () => {
    const health = syncHealth(input({ online: false, pendingCount: 3 }));
    expect(health.headline).toBe("3 changes waiting to sync");
    expect(health.detail).toBe("Saved on this phone. It goes up when you have signal.");
    expect(health.tone).toBe("pending");
  });

  it("never claims to be syncing while offline", () => {
    // The optimistic-label bug: a cycle can be mid-flight when the link drops.
    const health = syncHealth(input({ online: false, state: "syncing", pendingCount: 2 }));
    expect(health.headline).not.toMatch(/Sending|Syncing/);
    expect(health.headline).toBe("2 changes waiting to sync");
  });

  it("counts what it is sending while a cycle runs", () => {
    expect(syncHealth(input({ state: "syncing", pendingCount: 1 })).headline).toBe(
      "Sending 1 change…",
    );
    expect(syncHealth(input({ state: "syncing" })).headline).toBe("Syncing…");
  });

  it("puts an unresolvable issue above everything else", () => {
    // Retrying will never clear a parked op, so it outranks a queue and an
    // in-flight cycle alike.
    const health = syncHealth(
      input({ issueCount: 2, pendingCount: 4, state: "syncing" }),
    );
    expect(health).toEqual({
      headline: "2 changes need you",
      detail: "4 other changes are still queued.",
      tone: "problem",
    });
  });

  it("singularises the issue headline", () => {
    const health = syncHealth(input({ issueCount: 1 }));
    expect(health.headline).toBe("1 change needs you");
    expect(health.detail).toBe("Everything else is synced.");
  });

  it("owns up to a failed cycle with an empty outbox", () => {
    const health = syncHealth(input({ state: "error" }));
    expect(health.tone).toBe("problem");
    expect(health.headline).toBe("Can't reach your account");
    expect(health.detail).toBe("Last synced 2 min ago. It will keep retrying.");
  });

  describe("a failure the network is not to blame for", () => {
    // Observed on device: the server answered 200 to every request while the
    // app failed to apply the page locally, and the hero said "Can't reach your
    // account … It will keep retrying." Both halves were false, and the true
    // one — that nothing new will ever arrive until this is fixed — was nowhere.
    it("does not blame the connection", () => {
      const health = syncHealth(input({ state: "error", errorKind: "applyFailed" }));
      expect(health.headline).toBe("Couldn't download new data on this phone");
      expect(health.headline).not.toMatch(/reach/i);
      expect(health.tone).toBe("problem");
    });

    it("promises no retry, and points at the thing that does fix it", () => {
      const health = syncHealth(input({ state: "error", errorKind: "applyFailed" }));
      expect(health.detail).not.toMatch(/keep retrying/i);
      expect(health.detail).toContain("Account sync issues");
    });

    it("outranks the queue and the issue list", () => {
      // Nothing incoming works until it is resolved, so it is the answer.
      const health = syncHealth(
        input({ state: "error", errorKind: "applyFailed", issueCount: 3, pendingCount: 9 }),
      );
      expect(health.headline).toBe("Couldn't download new data on this phone");
    });

    it("still says 'unreachable' when that is what happened", () => {
      const health = syncHealth(input({ state: "error", errorKind: "unreachable" }));
      expect(health.headline).toBe("Can't reach your account");
      expect(health.detail).toContain("It will keep retrying.");
    });

    // The server is older than the app: /sync/push and /sync/delta 404. The
    // connection is fine, the queue is fine, and the one true statement is
    // that nothing can move until the server catches up.
    it("names a server that has no sync endpoints, and promises no retry", () => {
      const health = syncHealth(input({ state: "error", errorKind: "unsupported" }));
      expect(health.headline).toBe("The server isn't ready to sync");
      expect(health.headline).not.toMatch(/reach/i);
      expect(health.detail).not.toMatch(/retry/i);
      expect(health.tone).toBe("problem");
    });

    it("outranks a queue it cannot drain, and yields to an apply failure", () => {
      expect(
        syncHealth(input({ state: "error", errorKind: "unsupported", pendingCount: 9 }))
          .headline,
      ).toBe("The server isn't ready to sync");
      // applyFailed has a repair; this doesn't, so that one stays the answer.
      expect(
        syncHealth(input({ state: "error", errorKind: "applyFailed" })).headline,
      ).toBe("Couldn't download new data on this phone");
    });

    it("leaves a guest out of it — they have no account either way", () => {
      const health = syncHealth(
        input({ accountState: "guest", state: "error", errorKind: "applyFailed" }),
      );
      expect(health.headline).toBe("Saved on this phone");
    });
  });

  it("says so when nothing has ever synced", () => {
    const health = syncHealth(input({ lastSyncAt: null }));
    expect(health.detail).toBe("Nothing has reached your account yet.");
  });

  describe("guest", () => {
    // A guest's outbox rows are not "waiting" for anything — there is no
    // account for them to go to — so every sync sentence below would be a lie
    // about their data. The guest branch outranks all of them.
    it("answers where the data lives, not how a sync is going", () => {
      const health = syncHealth(
        input({ accountState: "guest", pendingCount: 120, issueCount: 3 }),
      );
      expect(health.headline).toBe("Saved on this phone");
      expect(health.detail).toContain("nothing is uploaded or backed up");
      expect(health.tone).toBe("ok");
    });

    it("says the same thing offline", () => {
      const health = syncHealth(input({ accountState: "guest", online: false }));
      expect(health.headline).toBe("Saved on this phone");
    });

    it("leaves a linked user's answers untouched", () => {
      const health = syncHealth(input({ accountState: "linked" }));
      expect(health.headline).toBe("Everything's synced");
    });
  });

  describe("bulk upload after linking an account", () => {
    // A first link can queue hundreds of ops. "Sending 847 changes…" with no
    // sense of duration reads as a hang and provokes pointless refreshing.
    it("reframes a large in-flight backlog as a long job", () => {
      const health = syncHealth(input({ state: "syncing", pendingCount: 847 }));
      expect(health.headline).toBe("Uploading 847 changes…");
      expect(health.detail).toContain("take a while");
      expect(health.tone).toBe("pending");
    });

    it("keeps the ordinary wording below the threshold", () => {
      const health = syncHealth(input({ state: "syncing", pendingCount: 3 }));
      expect(health.headline).toBe("Sending 3 changes…");
    });

    it("warns before the cycle starts too, when it can move", () => {
      const health = syncHealth(input({ pendingCount: 200 }));
      expect(health.headline).toBe("200 changes to upload");
      expect(health.detail).toContain("batches");
    });

    it("still leads with offline when the backlog can't move", () => {
      const health = syncHealth(input({ pendingCount: 200, online: false }));
      expect(health.headline).toBe("200 changes waiting to sync");
      expect(health.detail).toContain("when you have signal");
    });
  });
});

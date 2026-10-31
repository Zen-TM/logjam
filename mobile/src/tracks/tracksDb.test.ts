import { describe, expect, it, vi } from "vitest";

// A connection that throws on a nested BEGIN, like SQLite. Reverting any track
// write in tracksDb.ts to a bare `db.withTransactionAsync` turns this red.
let open = false;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const db = {
  withTransactionAsync: async (task: () => Promise<void>) => {
    if (open)
      throw new Error("cannot start a transaction within a transaction");
    open = true;
    try {
      await task();
    } finally {
      open = false;
    }
  },
  runAsync: async () => {
    await tick();
    return { changes: 0, lastInsertRowId: 0 };
  },
  getFirstAsync: async () => ({ maxSeq: null }),
};
vi.mock("../offline/registryDb", () => ({ getOfflineDb: async () => db }));
vi.mock("expo-sqlite", () => ({}));

import {
  appendRejectedFixes,
  appendTrackPoints,
  deleteTrack,
} from "./tracksDb";

describe("track writes", () => {
  it("deleteTrack waits for a location batch still being written", async () => {
    const point = { lat: 0, lng: 0, ele: null, t: 0 } as never;
    const batch = appendTrackPoints("t1", [point]);
    await expect(deleteTrack("t1")).resolves.toBeUndefined();
    await batch;
  });

  it("deleteTrack waits for a rejected-fix batch still being written", async () => {
    const batch = appendRejectedFixes("t1", [
      { lat: 0, lng: 0, t: 0 } as never,
    ]);
    await expect(deleteTrack("t1")).resolves.toBeUndefined();
    await batch;
  });
});

import { describe, expect, it } from "vitest";

import { mirrorQueryError } from "./mirrorQueryError";
import type { SyncStatus } from "./syncEngine";

const status = (patch: Partial<SyncStatus>): SyncStatus => ({
  state: "idle",
  lastSyncAt: null,
  errorMessage: null,
  errorKind: null,
  ...patch,
});

describe("mirrorQueryError", () => {
  it("says nothing about an unreachable server, however long it stays unreachable", () => {
    expect(
      mirrorQueryError(
        true,
        status({
          state: "error",
          errorMessage: "Couldn't sync. Will retry.",
          errorKind: "unreachable",
        }),
      ),
    ).toBeNull();
  });

  it("surfaces an apply failure — retrying can't fix it and Sync issues can", () => {
    expect(
      mirrorQueryError(
        true,
        status({
          state: "error",
          errorMessage: "This phone couldn't apply an update.",
          errorKind: "applyFailed",
        }),
      ),
    ).toBe("This phone couldn't apply an update.");
  });

  it("says nothing once the mirror has synced — the screen has content to show", () => {
    expect(
      mirrorQueryError(
        false,
        status({
          state: "error",
          errorMessage: "This phone couldn't apply an update.",
          errorKind: "applyFailed",
        }),
      ),
    ).toBeNull();
  });

  it("says nothing while idle or syncing", () => {
    expect(mirrorQueryError(true, status({}))).toBeNull();
    expect(mirrorQueryError(true, status({ state: "syncing" }))).toBeNull();
  });
});

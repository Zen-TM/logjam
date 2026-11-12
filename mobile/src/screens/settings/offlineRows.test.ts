import { describe, expect, it } from "vitest";

import { offlineRowNeedsAccount, type OfflineRow } from "./offlineRows";

const ROWS: OfflineRow[] = [
  "autoTopo",
  "topoDownload",
  "placeNames",
  "sync",
  "mediaUpload",
];

describe("offlineRowNeedsAccount", () => {
  // Red if `placeNames` is marked account-backed (the guest loses the one
  // allowance that governs a download they do make, ADR 0034) or if any other
  // row is marked device-only (a guest gets a switch for a job they never run).
  it("leaves a guest only the place-names allowance", () => {
    expect(ROWS.filter((r) => !offlineRowNeedsAccount(r, "guest"))).toEqual([
      "placeNames",
    ]);
  });

  // Red if the account check drops the `accountState === "guest"` test.
  it("blocks nothing for a linked install", () => {
    expect(ROWS.filter((r) => offlineRowNeedsAccount(r, "linked"))).toEqual([]);
  });
});

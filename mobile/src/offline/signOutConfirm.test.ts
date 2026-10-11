import { copyViolations } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import {
  signOutConfirm,
  signOutConfirmBody,
  type SignOutCounts,
} from "./signOutConfirm";

const none: SignOutCounts = {
  unsynced: 0,
  unresolved: 0,
  recordings: 0,
  routeDraft: 0,
  regions: 0,
  regionBytes: 0,
  geoPdfs: 0,
  topos: 0,
};

describe("signOutConfirm", () => {
  // Nothing on the phone that the account lacks: a confirm would only be a
  // speed bump.
  it("asks nothing when there is nothing to lose", () => {
    expect(signOutConfirm(none, true)).toBeNull();
    expect(
      signOutConfirm({ ...none, regionBytes: 5_000_000 }, true),
    ).toBeNull();
  });

  it("says what goes and what stays, one line per kind that has something", () => {
    const confirm = signOutConfirm(
      {
        ...none,
        unsynced: 3,
        regions: 2,
        regionBytes: 250 * 1024 ** 2,
        geoPdfs: 1,
        topos: 4,
      },
      false,
    );
    expect(confirm).toEqual({
      title: "Sign out of Logjam GPS?",
      intro: "This removes from this phone:",
      lines: [
        "3 changes not yet synced. These are lost for good.",
        "2 saved map regions (250 MB)",
        "1 imported GeoPDF. An imported file can only come back from the original file.",
        "4 LiDAR topos",
      ],
      keeps: "Your synced places and trips stay in your account.",
      canSyncFirst: false,
    });
  });

  it("leaves out a kind with nothing in it", () => {
    const confirm = signOutConfirm({ ...none, topos: 1 }, true);
    expect(confirm?.lines).toEqual(["1 LiDAR topo"]);
  });

  it("says a single change is lost in the singular", () => {
    expect(signOutConfirm({ ...none, unsynced: 1 }, false)?.lines).toEqual([
      "1 change not yet synced. It is lost for good.",
    ]);
  });

  it("offers Sync first only with unsynced changes and a connection", () => {
    expect(signOutConfirm({ ...none, unsynced: 2 }, true)?.canSyncFirst).toBe(
      true,
    );
    expect(signOutConfirm({ ...none, unsynced: 2 }, false)?.canSyncFirst).toBe(
      false,
    );
    // Regions are not synced work: syncing cannot save them.
    expect(signOutConfirm({ ...none, regions: 1 }, true)?.canSyncFirst).toBe(
      false,
    );
  });

  it("keeps the copy rules and carries no name or coordinate", () => {
    const confirm = signOutConfirm(
      {
        unsynced: 2,
        unresolved: 2,
        recordings: 2,
        routeDraft: 1,
        regions: 2,
        regionBytes: 1024 ** 3,
        geoPdfs: 2,
        topos: 2,
      },
      true,
    )!;
    const body = signOutConfirmBody(confirm);
    expect(
      [confirm.title, confirm.intro, ...confirm.lines, confirm.keeps].flatMap(
        copyViolations,
      ),
    ).toEqual([]);
    // Counts and a size only: no decimal coordinate, no quoted name.
    expect(body).not.toMatch(/-?\d+\.\d{4,}/);
    expect(body).not.toMatch(/["“”]/);
    expect(body.split("\n")[0]).toBe("This removes from this phone:");
  });
});

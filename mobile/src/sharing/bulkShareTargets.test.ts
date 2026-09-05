// The triage and the confirm. Both are COPY, and copy about an irrevocable
// action: a confirm that says "will be shared" over rows that are actually
// being handed over for keeps is the one failure this feature must not have.
import { describe, expect, it } from "vitest";

import {
  bulkShareConfirm,
  bulkShareTitle,
  bulkShareTriageLine,
  planBulkShareSelection,
  type BulkShareCandidate,
} from "./bulkShareTargets";

const sendCopy = {
  sourceKind: "track" as const,
  filename: "Claustral.gpx",
  resolveFile: async () => ({ uri: "file:///tmp/x.gpx" }),
};

const waypoint: BulkShareCandidate = {
  key: "w1",
  share: { entityType: "waypoint", entityId: "w1" },
};
const canyon: BulkShareCandidate = {
  key: "c1",
  share: { entityType: "canyon", entityId: "c1" },
};
const track: BulkShareCandidate = { key: "t1", sendCopy };
/** Nothing waiting in the outbox — the ordinary case for most of these. */
const ALL_SYNCED: ReadonlySet<string> = new Set<string>();
const region: BulkShareCandidate = { key: "region:r1" };
const theirs: BulkShareCandidate = {
  key: "w2",
  sharedWithYou: true,
  share: { entityType: "waypoint", entityId: "w2" },
};

describe("planBulkShareSelection", () => {
  it("sorts a mixed selection into the two verbs and the leftovers", () => {
    const plan = planBulkShareSelection([waypoint, track, region, canyon], ALL_SYNCED);
    expect(plan.shares).toEqual([
      { entityType: "waypoint", entityId: "w1" },
      { entityType: "canyon", entityId: "c1" },
    ]);
    expect(plan.copies).toEqual([track]);
    expect(plan.skipped).toEqual([{ candidate: region, reason: "not-shareable" }]);
    expect(plan.actionableCount).toBe(3);
  });

  it("never re-shares something shared WITH the user, even though it has a share descriptor", () => {
    const plan = planBulkShareSelection([theirs], ALL_SYNCED);
    expect(plan.shares).toEqual([]);
    expect(plan.skipped).toEqual([{ candidate: theirs, reason: "shared-with-you" }]);
  });

  it("breaks a both-verbs tie towards the revocable one", () => {
    const both: BulkShareCandidate = {
      key: "b1",
      share: { entityType: "route", entityId: "b1" },
      sendCopy,
    };
    const plan = planBulkShareSelection([both], ALL_SYNCED);
    expect(plan.shares).toHaveLength(1);
    expect(plan.copies).toHaveLength(0);
  });
});

describe("bulkShareTitle", () => {
  it("says Send the moment one copy is in the selection", () => {
    expect(bulkShareTitle(planBulkShareSelection([waypoint, track], ALL_SYNCED))).toBe("Send 2 items");
  });

  it("says Share when nothing leaves for good", () => {
    expect(bulkShareTitle(planBulkShareSelection([waypoint, canyon], ALL_SYNCED))).toBe("Share 2 items");
  });

  it("counts what can be acted on, not what was picked", () => {
    expect(bulkShareTitle(planBulkShareSelection([waypoint, region, region], ALL_SYNCED))).toBe(
      "Share 1 item",
    );
  });
});

describe("bulkShareTriageLine", () => {
  it("says nothing when everything can be shared", () => {
    expect(bulkShareTriageLine(planBulkShareSelection([waypoint, track], ALL_SYNCED))).toBeNull();
  });

  // The bug this axis exists for, in bulk: a route drawn in the field has no
  // server row, so sending it to the grant endpoint answers 404 and reports a
  // predictable exclusion as a failure.
  it("skips a row the account does not hold yet, and keeps the copies", () => {
    const plan = planBulkShareSelection([waypoint, track], new Set(["w1"]));
    expect(plan.shares).toEqual([]);
    expect(plan.copies).toEqual([track]);
    expect(plan.skipped).toEqual([{ candidate: waypoint, reason: "not-uploaded" }]);
    expect(plan.actionableCount).toBe(1);
  });

  // "Send a copy" ships a local FILE and never needs the entity to exist
  // server-side, so an unsynced id must not withhold it.
  it("never withholds a copy over an unsynced id", () => {
    const plan = planBulkShareSelection([track], new Set(["t1"]));
    expect(plan.copies).toEqual([track]);
    expect(plan.skipped).toEqual([]);
  });

  it("names both reasons when both are present", () => {
    const line = bulkShareTriageLine(
      planBulkShareSelection([waypoint, region, theirs], ALL_SYNCED),
    );
    expect(line).toBe("1 of 3 can be shared — skipping 1 shared with you and 1 can't be shared.");
  });

  it("names all three reasons, and the unsynced one as temporary", () => {
    const line = bulkShareTriageLine(
      planBulkShareSelection([waypoint, canyon, region, theirs], new Set(["c1"])),
    );
    expect(line).toBe(
      "1 of 4 can be shared — skipping 1 shared with you, 1 not synced yet and 1 can't be shared.",
    );
  });

  it("has its own sentence when nothing at all can go", () => {
    const line = bulkShareTriageLine(planBulkShareSelection([region, region], ALL_SYNCED));
    // Two identical candidates are two rows here — the screen deduped by key
    // long before this, and the plan counts what it is given.
    expect(line).toBe("None of these 2 can be shared — 2 can't be shared.");
  });
});

describe("bulkShareConfirm", () => {
  it("states each verb in its OWN words, copies last", () => {
    const confirm = bulkShareConfirm(
      planBulkShareSelection([waypoint, canyon, track], ALL_SYNCED),
      3,
    );
    expect(confirm?.title).toBe("Send to 3 friends?");
    expect(confirm?.body).toContain("2 items will be shared");
    expect(confirm?.body).toContain("stop sharing whenever you like");
    expect(confirm?.body).toContain("1 item will be sent as a copy");
    expect(confirm?.body).toContain("can't take them back");
    // Copies are the LAST thing read before the button is tapped.
    expect(confirm!.body.indexOf("shared")).toBeLessThan(
      confirm!.body.indexOf("copy"),
    );
  });

  it("never says Share on a run that hands anything over for keeps", () => {
    expect(bulkShareConfirm(planBulkShareSelection([track], ALL_SYNCED), 1)?.confirmLabel).toBe("Send");
    expect(bulkShareConfirm(planBulkShareSelection([waypoint], ALL_SYNCED), 1)?.confirmLabel).toBe(
      "Share",
    );
  });

  it("makes no promise about a verb the run does not use", () => {
    const shareOnly = bulkShareConfirm(planBulkShareSelection([waypoint], ALL_SYNCED), 1);
    expect(shareOnly?.body).not.toContain("copy");
    const copyOnly = bulkShareConfirm(planBulkShareSelection([track], ALL_SYNCED), 1);
    expect(copyOnly?.body).not.toContain("stop sharing");
  });

  it("has nothing to confirm with no recipients or nothing actionable", () => {
    expect(bulkShareConfirm(planBulkShareSelection([waypoint], ALL_SYNCED), 0)).toBeNull();
    expect(bulkShareConfirm(planBulkShareSelection([region], ALL_SYNCED), 2)).toBeNull();
  });
});

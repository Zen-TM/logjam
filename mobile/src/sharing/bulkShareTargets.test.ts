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
const region: BulkShareCandidate = { key: "region:r1" };
const theirs: BulkShareCandidate = {
  key: "w2",
  sharedWithYou: true,
  share: { entityType: "waypoint", entityId: "w2" },
};

describe("planBulkShareSelection", () => {
  it("sorts a mixed selection into the two verbs and the leftovers", () => {
    const plan = planBulkShareSelection([waypoint, track, region, canyon]);
    expect(plan.shares).toEqual([
      { entityType: "waypoint", entityId: "w1" },
      { entityType: "canyon", entityId: "c1" },
    ]);
    expect(plan.copies).toEqual([track]);
    expect(plan.skipped).toEqual([{ candidate: region, reason: "not-shareable" }]);
    expect(plan.actionableCount).toBe(3);
  });

  it("never re-shares something shared WITH the user, even though it has a share descriptor", () => {
    const plan = planBulkShareSelection([theirs]);
    expect(plan.shares).toEqual([]);
    expect(plan.skipped).toEqual([{ candidate: theirs, reason: "shared-with-you" }]);
  });

  it("breaks a both-verbs tie towards the revocable one", () => {
    const both: BulkShareCandidate = {
      key: "b1",
      share: { entityType: "route", entityId: "b1" },
      sendCopy,
    };
    const plan = planBulkShareSelection([both]);
    expect(plan.shares).toHaveLength(1);
    expect(plan.copies).toHaveLength(0);
  });
});

describe("bulkShareTitle", () => {
  it("says Send the moment one copy is in the selection", () => {
    expect(bulkShareTitle(planBulkShareSelection([waypoint, track]))).toBe("Send 2 items");
  });

  it("says Share when nothing leaves for good", () => {
    expect(bulkShareTitle(planBulkShareSelection([waypoint, canyon]))).toBe("Share 2 items");
  });

  it("counts what can be acted on, not what was picked", () => {
    expect(bulkShareTitle(planBulkShareSelection([waypoint, region, region]))).toBe(
      "Share 1 item",
    );
  });
});

describe("bulkShareTriageLine", () => {
  it("says nothing when everything can be shared", () => {
    expect(bulkShareTriageLine(planBulkShareSelection([waypoint, track]))).toBeNull();
  });

  it("names both reasons when both are present", () => {
    const line = bulkShareTriageLine(
      planBulkShareSelection([waypoint, region, theirs]),
    );
    expect(line).toBe("1 of 3 can be shared — skipping 1 shared with you and 1 can't be shared.");
  });

  it("has its own sentence when nothing at all can go", () => {
    const line = bulkShareTriageLine(planBulkShareSelection([region, region]));
    // Two identical candidates are two rows here — the screen deduped by key
    // long before this, and the plan counts what it is given.
    expect(line).toBe("None of these 2 can be shared — 2 can't be shared.");
  });
});

describe("bulkShareConfirm", () => {
  it("states each verb in its OWN words, copies last", () => {
    const confirm = bulkShareConfirm(
      planBulkShareSelection([waypoint, canyon, track]),
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
    expect(bulkShareConfirm(planBulkShareSelection([track]), 1)?.confirmLabel).toBe("Send");
    expect(bulkShareConfirm(planBulkShareSelection([waypoint]), 1)?.confirmLabel).toBe(
      "Share",
    );
  });

  it("makes no promise about a verb the run does not use", () => {
    const shareOnly = bulkShareConfirm(planBulkShareSelection([waypoint]), 1);
    expect(shareOnly?.body).not.toContain("copy");
    const copyOnly = bulkShareConfirm(planBulkShareSelection([track]), 1);
    expect(copyOnly?.body).not.toContain("stop sharing");
  });

  it("has nothing to confirm with no recipients or nothing actionable", () => {
    expect(bulkShareConfirm(planBulkShareSelection([waypoint]), 0)).toBeNull();
    expect(bulkShareConfirm(planBulkShareSelection([region]), 2)).toBeNull();
  });
});

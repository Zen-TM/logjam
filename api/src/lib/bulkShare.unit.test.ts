// The counting is the thing worth testing: `granted`, `alreadyShared` and
// `ineligible` end up in the sentence the user reads after a bulk share, and a
// tally that forgets to multiply by the recipients is invisible in a passing
// integration test.
import { describe, expect, it } from "vitest";

import { MAX_BULK_SHARE_ITEMS, type BulkShareItem, type BulkShareItemType } from "@logjam/shared";

import { parseBulkShareItems, planBulkShare, sharePairKey } from "./bulkShare";
import { AppError } from "../middleware/errorHandler";

function owned(
  entries: [BulkShareItemType, string[]][],
): Map<BulkShareItemType, Set<string>> {
  return new Map(entries.map(([type, ids]) => [type, new Set(ids)]));
}

describe("parseBulkShareItems", () => {
  it("accepts an empty list — a copy-only bulk grants no shares", () => {
    expect(parseBulkShareItems([])).toEqual([]);
  });

  it("rejects a non-array", () => {
    expect(() => parseBulkShareItems({})).toThrow(AppError);
  });

  it("rejects more than the cap with 413", () => {
    const tooMany = Array.from({ length: MAX_BULK_SHARE_ITEMS + 1 }, (_, i) => ({
      entityType: "waypoint",
      entityId: `w${i}`,
    }));
    expect(() => parseBulkShareItems(tooMany)).toThrow(
      expect.objectContaining({ statusCode: 413 }),
    );
  });

  it("rejects an unknown entityType", () => {
    expect(() =>
      parseBulkShareItems([{ entityType: "tripLog", entityId: "t1" }]),
    ).toThrow(AppError);
  });

  it("admits canyon, which /shares does not", () => {
    expect(parseBulkShareItems([{ entityType: "canyon", entityId: "c1" }])).toEqual([
      { entityType: "canyon", entityId: "c1" },
    ]);
  });

  it("rejects a missing entityId", () => {
    expect(() => parseBulkShareItems([{ entityType: "route" }])).toThrow(AppError);
  });

  it("drops a repeated item rather than failing the whole action", () => {
    const items = parseBulkShareItems([
      { entityType: "route", entityId: "r1" },
      { entityType: "route", entityId: "r1" },
      { entityType: "waypoint", entityId: "r1" },
    ]);
    // Same id, different table — not a duplicate.
    expect(items).toEqual([
      { entityType: "route", entityId: "r1" },
      { entityType: "waypoint", entityId: "r1" },
    ]);
  });
});

describe("planBulkShare", () => {
  const items: BulkShareItem[] = [
    { entityType: "waypoint", entityId: "w1" },
    { entityType: "route", entityId: "r1" },
    { entityType: "canyon", entityId: "c1" },
  ];

  it("grants the cross product when everything is owned and nothing is shared", () => {
    const plan = planBulkShare({
      items,
      recipientIds: ["bob", "carol"],
      ownedIdsByType: owned([
        ["waypoint", ["w1"]],
        ["route", ["r1"]],
        ["canyon", ["c1"]],
      ]),
      existingPairKeys: new Set(),
    });
    expect(plan.result).toEqual({ granted: 6, alreadyShared: 0, ineligible: 0 });
    expect(plan.grants).toHaveLength(6);
  });

  it("counts an unowned item once PER RECIPIENT, so the totals add up", () => {
    const plan = planBulkShare({
      items,
      recipientIds: ["bob", "carol", "dave"],
      // r1 is someone else's, or gone since the list was built — the plan
      // cannot tell the two apart, and must not.
      ownedIdsByType: owned([
        ["waypoint", ["w1"]],
        ["route", []],
        ["canyon", ["c1"]],
      ]),
      existingPairKeys: new Set(),
    });
    expect(plan.result).toEqual({ granted: 6, alreadyShared: 0, ineligible: 3 });
    const total =
      plan.result.granted + plan.result.alreadyShared + plan.result.ineligible;
    expect(total).toBe(items.length * 3);
  });

  it("skips a pair that already exists instead of erroring", () => {
    const plan = planBulkShare({
      items,
      recipientIds: ["bob", "carol"],
      ownedIdsByType: owned([
        ["waypoint", ["w1"]],
        ["route", ["r1"]],
        ["canyon", ["c1"]],
      ]),
      existingPairKeys: new Set([
        sharePairKey("waypoint", "w1", "bob"),
        sharePairKey("canyon", "c1", "carol"),
      ]),
    });
    expect(plan.result).toEqual({ granted: 4, alreadyShared: 2, ineligible: 0 });
    expect(
      plan.grants.some((g) => g.entityId === "w1" && g.sharedWithId === "bob"),
    ).toBe(false);
  });

  it("touches only the ids that gained a grant, and only once each", () => {
    const plan = planBulkShare({
      items,
      recipientIds: ["bob", "carol"],
      ownedIdsByType: owned([
        ["waypoint", ["w1"]],
        ["route", ["r1"]],
        ["canyon", ["c1"]],
      ]),
      // r1 is fully shared already — its watermark must NOT move, or every
      // recipient re-pulls a row that did not change.
      existingPairKeys: new Set([
        sharePairKey("route", "r1", "bob"),
        sharePairKey("route", "r1", "carol"),
      ]),
    });
    expect(plan.touchedIdsByType.get("waypoint")).toEqual(["w1"]);
    expect(plan.touchedIdsByType.get("canyon")).toEqual(["c1"]);
    expect(plan.touchedIdsByType.has("route")).toBe(false);
  });

  it("plans nothing for an empty item list", () => {
    const plan = planBulkShare({
      items: [],
      recipientIds: ["bob"],
      ownedIdsByType: new Map(),
      existingPairKeys: new Set(),
    });
    expect(plan.result).toEqual({ granted: 0, alreadyShared: 0, ineligible: 0 });
    expect(plan.touchedIdsByType.size).toBe(0);
  });
});

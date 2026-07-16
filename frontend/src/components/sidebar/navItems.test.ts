import { describe, it, expect } from "vitest";
import {
  partitionNavItems,
  aggregateBadgeCount,
  isPanelInMore,
  NAV_ITEMS_FOR_TEST,
  type NavItem,
  type NavItemId,
} from "./navItems";

const { ALL_ITEMS, TOP_ITEMS, BOTTOM_ITEMS } = NAV_ITEMS_FOR_TEST;

const ids = (items: NavItem[]): NavItemId[] => items.map((item) => item.id);

describe("partitionNavItems", () => {
  it("keeps every item on the rail on desktop", () => {
    const { railItems, moreItems } = partitionNavItems(false);
    expect(ids(railItems)).toEqual(ids(ALL_ITEMS));
    expect(moreItems).toEqual([]);
  });

  it("keeps the desktop group spacer between the feature and personal groups", () => {
    const { spacerAfterIndex } = partitionNavItems(false);
    expect(spacerAfterIndex).toBe(TOP_ITEMS.length - 1);
    // The spacer must land on the boundary, not inside a group.
    const { railItems } = partitionNavItems(false);
    expect(railItems[spacerAfterIndex!].id).toBe(TOP_ITEMS[TOP_ITEMS.length - 1].id);
    expect(railItems[spacerAfterIndex! + 1].id).toBe(BOTTOM_ITEMS[0].id);
  });

  it("leaves four rail slots on mobile: three items plus More", () => {
    const { railItems, spacerAfterIndex } = partitionNavItems(true);
    expect(ids(railItems)).toEqual(["layers", "canyons", "trip-logs"]);
    expect(spacerAfterIndex).toBeNull();
  });

  it("fits a 390px viewport once More replaces the overflow", () => {
    // .navItem width 48 + mobile margin-right 4; .navRail padding 0 4px.
    const { railItems } = partitionNavItems(true);
    const width = (railItems.length + 1) * (48 + 4) + 4 * 2; // +1 for the More button
    expect(width).toBeLessThanOrEqual(390);
  });

  it("partitions mobile items exhaustively and without overlap", () => {
    const { railItems, moreItems } = partitionNavItems(true);
    const combined = [...ids(railItems), ...ids(moreItems)];
    expect(new Set(combined).size).toBe(combined.length); // disjoint
    expect([...combined].sort()).toEqual([...ids(ALL_ITEMS)].sort()); // exhaustive
  });

  it("puts the badged item first in More", () => {
    const { moreItems } = partitionNavItems(true);
    expect(moreItems[0].id).toBe("notifications");
  });

  it("keeps account last in More", () => {
    const { moreItems } = partitionNavItems(true);
    expect(moreItems[moreItems.length - 1].id).toBe("account");
  });
});

describe("aggregateBadgeCount", () => {
  const { moreItems } = partitionNavItems(true);

  it("is zero with no counts", () => {
    expect(aggregateBadgeCount(moreItems, {})).toBe(0);
  });

  it("is zero when every count is zero", () => {
    expect(aggregateBadgeCount(moreItems, { notifications: 0 })).toBe(0);
  });

  it("surfaces unread alerts through More", () => {
    expect(aggregateBadgeCount(moreItems, { notifications: 3 })).toBe(3);
  });

  it("sums a second badged item without any change to the aggregator", () => {
    // The forward-compatibility guarantee: a future `friends` badge needs only
    // the extra key here, not a rework of More's badge.
    expect(aggregateBadgeCount(moreItems, { notifications: 3, friends: 2 })).toBe(5);
  });

  it("ignores counts for items that are not in the given group", () => {
    // `layers` sits on the mobile rail, so its count must not leak into More.
    expect(aggregateBadgeCount(moreItems, { layers: 9 })).toBe(0);
  });

  it("is zero for an empty group, so desktop's absent More never badges", () => {
    expect(aggregateBadgeCount([], { notifications: 3 })).toBe(0);
  });
});

describe("isPanelInMore", () => {
  const { moreItems } = partitionNavItems(true);

  it("selects More while a panel inside it is open", () => {
    expect(isPanelInMore(moreItems, "notifications")).toBe(true);
    expect(isPanelInMore(moreItems, "account")).toBe(true);
  });

  it("does not select More for a rail panel", () => {
    expect(isPanelInMore(moreItems, "canyons")).toBe(false);
  });

  it("does not select More when no panel is open", () => {
    expect(isPanelInMore(moreItems, null)).toBe(false);
  });

  it("does not select More for canyon-detail, which is not a nav item", () => {
    expect(isPanelInMore(moreItems, "canyon-detail")).toBe(false);
  });

  it("never selects More on desktop, where the group is empty", () => {
    expect(isPanelInMore([], "notifications")).toBe(false);
  });
});

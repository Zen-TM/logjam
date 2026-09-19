import { describe, it, expect } from "vitest";
import {
  partitionNavItems,
  aggregateBadgeCount,
  isPanelInMore,
  labelWithBadge,
  NAV_ITEMS_FOR_TEST,
  type NavItem,
  type NavItemId,
} from "./navItems";

const { ALL_ITEMS, PAGE_ITEMS, PERSONAL_ITEMS } = NAV_ITEMS_FOR_TEST;

const ids = (items: NavItem[]): NavItemId[] => items.map((item) => item.id);

describe("partitionNavItems", () => {
  it("orders the desktop rail as pages, then personal items", () => {
    const { railItems, moreItems } = partitionNavItems(false);
    expect(ids(railItems)).toEqual([
      "places",
      "logs",
      "ways",
      "maps",
      "friends",
      "inbox",
      "account",
      "settings",
    ]);
    expect(moreItems).toEqual([]);
  });

  it("puts the spacer on the boundary between the two groups", () => {
    const { railItems, spacerAfterIndex } = partitionNavItems(false);
    expect(railItems[spacerAfterIndex!].id).toBe(PAGE_ITEMS[PAGE_ITEMS.length - 1].id);
    expect(railItems[spacerAfterIndex! + 1].id).toBe(PERSONAL_ITEMS[0].id);
  });

  it("gives narrow web Logjam GPS's tabs: Places, Logs, Ways between Map and More", () => {
    const { railItems, spacerAfterIndex } = partitionNavItems(true);
    expect(ids(railItems)).toEqual(["places", "logs", "ways"]);
    expect(spacerAfterIndex).toBeNull();
  });

  it("fits five 72px tabs in a 390px viewport", () => {
    const { railItems } = partitionNavItems(true);
    expect((railItems.length + 2) * 72).toBeLessThanOrEqual(390); // + Map and More
  });

  it("partitions narrow items exhaustively and without overlap", () => {
    const { railItems, moreItems } = partitionNavItems(true);
    const combined = [...ids(railItems), ...ids(moreItems)];
    expect(new Set(combined).size).toBe(combined.length);
    expect([...combined].sort()).toEqual([...ids(ALL_ITEMS)].sort());
  });

  it("puts the badged item first in More", () => {
    expect(partitionNavItems(true).moreItems[0].id).toBe("inbox");
  });
});

describe("aggregateBadgeCount", () => {
  const { moreItems } = partitionNavItems(true);

  it("is zero with no counts", () => {
    expect(aggregateBadgeCount(moreItems, {})).toBe(0);
  });

  it("surfaces unread inbox items through More", () => {
    expect(aggregateBadgeCount(moreItems, { inbox: 3 })).toBe(3);
  });

  it("sums a second badged item", () => {
    expect(aggregateBadgeCount(moreItems, { inbox: 3, friends: 2 })).toBe(5);
  });

  it("ignores counts for items on the tabs", () => {
    expect(aggregateBadgeCount(moreItems, { places: 9 })).toBe(0);
  });
});

describe("isPanelInMore", () => {
  const { moreItems } = partitionNavItems(true);

  it("selects More while a panel inside it is open", () => {
    expect(isPanelInMore(moreItems, "inbox")).toBe(true);
    expect(isPanelInMore(moreItems, "settings")).toBe(true);
  });

  it("does not select More for a tab, for no panel, or for place-detail", () => {
    expect(isPanelInMore(moreItems, "places")).toBe(false);
    expect(isPanelInMore(moreItems, null)).toBe(false);
    expect(isPanelInMore(moreItems, "place-detail")).toBe(false);
  });

  it("never selects More on desktop, where the group is empty", () => {
    expect(isPanelInMore([], "inbox")).toBe(false);
  });
});

describe("labelWithBadge", () => {
  it("names the count so the visual badge can be hidden from assistive tech", () => {
    expect(labelWithBadge("Inbox", 3)).toBe("Inbox, 3 unread");
    expect(labelWithBadge("Inbox", 0)).toBe("Inbox");
  });
});

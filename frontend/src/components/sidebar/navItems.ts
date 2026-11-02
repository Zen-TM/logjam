import { navFor, type NavEntry, type NavIdOn } from "@logjam/shared";
import type { PanelId } from "./panels";

/**
 * Panels reachable from the nav: Logjam Web's entries in `NAV`. The rest of
 * `PanelId` is opened programmatically — a pin, a row, a line on the map — and
 * is never a nav item. `navItems.test.ts` keeps the two lists equal.
 */
export type NavItemId = Extract<NavIdOn<"web">, PanelId>;

export type NavItem = Omit<NavEntry, "id"> & { id: NavItemId };

/** Unread/attention counts keyed by the item they belong to. A count of 0 or an
 *  absent key means "no badge". */
export type NavBadgeCounts = Partial<Record<NavItemId, number>>;

// The order, the words and the icons are `NAV`'s (shared/src/contracts/nav.ts).
const WEB: NavItem[] = navFor("web");

/** The pages — the rail's top group. */
const PAGE_ITEMS: NavItem[] = WEB.filter((item) => item.group === "page");

/** Personal and status pages — the rail's bottom group, below the spacer. */
const PERSONAL_ITEMS: NavItem[] = WEB.filter(
  (item) => item.group === "personal",
);

const ALL_ITEMS: NavItem[] = [...PAGE_ITEMS, ...PERSONAL_ITEMS];

/** Narrow web keeps Logjam GPS's tab bar — Map · Places · Trips · Ways · More —
 *  so a user who knows one knows the other. `Map` is not a page (it closes the
 *  open one), so it is not in `NAV`. */
const TAB_ITEMS: NavItem[] = WEB.filter((item) => item.tab);

/** The More menu, in `NAV`'s order: Inbox first, the badged item. */
const MORE_ITEMS: NavItem[] = WEB.filter((item) => !item.tab);

export type NavPartition = {
  /** Rendered directly on the rail (or as tabs on narrow web). */
  railItems: NavItem[];
  /** Rendered inside More. Empty on desktop, where More isn't shown. */
  moreItems: NavItem[];
  /** Desktop renders a flex spacer between the top and bottom groups. */
  spacerAfterIndex: number | null;
};

/** Split the nav into rail items and More items. The 84px desktop rail holds
 *  all eight; narrow web holds three tabs beside Map and More. */
export function partitionNavItems(isNarrow: boolean): NavPartition {
  if (!isNarrow) {
    return {
      railItems: ALL_ITEMS,
      moreItems: [],
      spacerAfterIndex: PAGE_ITEMS.length - 1,
    };
  }
  return {
    railItems: TAB_ITEMS,
    moreItems: MORE_ITEMS,
    spacerAfterIndex: null,
  };
}

/** Total badge count across the given items. Drives More's badge. */
export function aggregateBadgeCount(
  items: NavItem[],
  counts: NavBadgeCounts,
): number {
  return items.reduce((sum, item) => sum + (counts[item.id] ?? 0), 0);
}

/** True when the open panel lives inside More, so More reads as selected. */
export function isPanelInMore(
  moreItems: NavItem[],
  activePanel: PanelId | null,
): boolean {
  return moreItems.some((item) => item.id === activePanel);
}

/** More's badge sums items that count different things (unread, invited). */
export const MORE_BADGE_NOUN = "new";

export const NAV_ITEMS_FOR_TEST = { ALL_ITEMS, PAGE_ITEMS, PERSONAL_ITEMS };

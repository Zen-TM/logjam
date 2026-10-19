import type { PanelId } from "./panels";
import { type Glyph } from "../../ui";

/**
 * Panels reachable from the nav. The rest of `PanelId` is opened
 * programmatically — a pin, a row, a line on the map — and is never a nav item.
 * `navItems.test.ts` keeps this list equal to the panels the rail does not
 * carry.
 */
export type NavItemId = Exclude<
  PanelId,
  | "place-detail"
  | "trip-detail"
  | "way-detail"
  | "plan-detail"
  | "way-draw"
  | "measure"
>;

export type NavItem = {
  id: NavItemId;
  label: string;
  icon: Glyph;
  /** What its badge counts, in its accessible name: "Plans, 1 invited". */
  badgeNoun?: string;
};

/** Unread/attention counts keyed by the item they belong to. A count of 0 or an
 *  absent key means "no badge". */
export type NavBadgeCounts = Partial<Record<NavItemId, number>>;

/** The pages — the rail's top group. */
const PAGE_ITEMS: NavItem[] = [
  { id: "places", label: "Places", icon: "place" },
  { id: "logs", label: "Logs", icon: "trip" },
  // The umbrella for routes, recorded tracks and imports. "Routes" would name
  // one of its own three kinds.
  { id: "ways", label: "Ways", icon: "route" },
  { id: "maps", label: "Maps", icon: "map" },
  // An invite waiting on the user is what its badge counts.
  { id: "plans", label: "Plans", icon: "plan", badgeNoun: "invited" },
  { id: "friends", label: "Friends", icon: "friends" },
];

/** Personal and status pages — the rail's bottom group, below the spacer. */
const PERSONAL_ITEMS: NavItem[] = [
  { id: "inbox", label: "Inbox", icon: "notifications" },
  { id: "account", label: "Account", icon: "account" },
  { id: "settings", label: "Settings", icon: "settings" },
];

const ALL_ITEMS: NavItem[] = [...PAGE_ITEMS, ...PERSONAL_ITEMS];

/** Narrow web keeps Logjam GPS's tab bar — Map · Places · Logs · Ways · More —
 *  so a user who knows one knows the other. `Map` is not a page (it closes the
 *  open one), so it is not in this list. */
const NARROW_TAB_IDS: NavItemId[] = ["places", "logs", "ways"];

/** The More menu, most- to least-reached. Inbox first: it is badged most
 *  often, and landing on it is what makes More's badge pay off in one glance. */
const MORE_ITEM_IDS: NavItemId[] = [
  "inbox",
  "plans",
  "maps",
  "friends",
  "account",
  "settings",
];

function itemById(id: NavItemId): NavItem {
  const item = ALL_ITEMS.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`No nav item registered for panel "${id}"`);
  return item;
}

export type NavPartition = {
  /** Rendered directly on the rail (or as tabs on narrow web). */
  railItems: NavItem[];
  /** Rendered inside More. Empty on desktop, where More isn't shown. */
  moreItems: NavItem[];
  /** Desktop renders a flex spacer between the top and bottom groups. */
  spacerAfterIndex: number | null;
};

/** Split the nav into rail items and More items. The 84px desktop rail holds
 *  all nine; narrow web holds three tabs beside Map and More. */
export function partitionNavItems(isNarrow: boolean): NavPartition {
  if (!isNarrow) {
    return {
      railItems: ALL_ITEMS,
      moreItems: [],
      spacerAfterIndex: PAGE_ITEMS.length - 1,
    };
  }
  return {
    railItems: NARROW_TAB_IDS.map(itemById),
    moreItems: MORE_ITEM_IDS.map(itemById),
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

/** "Inbox, 3 unread" — the badge is aria-hidden, so its count joins the name. */
export function labelWithBadge(
  label: string,
  count: number,
  noun = "unread",
): string {
  return count > 0 ? `${label}, ${count} ${noun}` : label;
}

export const NAV_ITEMS_FOR_TEST = { ALL_ITEMS, PAGE_ITEMS, PERSONAL_ITEMS };

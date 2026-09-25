import {
  Bell,
  BookOpen,
  CircleUser,
  Map,
  MapPin,
  Route,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { PanelId } from "./panels";

/** Panels reachable from the nav. `place-detail` and `route-detail` are opened
 *  programmatically (from the map / a list), never from a nav item. */
export type NavItemId = Exclude<PanelId, "place-detail" | "route-detail">;

export type NavItem = {
  id: NavItemId;
  label: string;
  Icon: LucideIcon;
};

/** Unread/attention counts keyed by the item they belong to. A count of 0 or an
 *  absent key means "no badge". */
export type NavBadgeCounts = Partial<Record<NavItemId, number>>;

/** The pages — the rail's top group. */
const PAGE_ITEMS: NavItem[] = [
  { id: "places", label: "Places", Icon: MapPin },
  { id: "logs", label: "Logs", Icon: BookOpen },
  // The umbrella for routes, recorded tracks and imports. "Routes" would name
  // one of its own three kinds.
  { id: "ways", label: "Ways", Icon: Route },
  { id: "maps", label: "Maps", Icon: Map },
  { id: "friends", label: "Friends", Icon: Users },
];

/** Personal and status pages — the rail's bottom group, below the spacer. */
const PERSONAL_ITEMS: NavItem[] = [
  { id: "inbox", label: "Inbox", Icon: Bell },
  { id: "account", label: "Account", Icon: CircleUser },
  { id: "settings", label: "Settings", Icon: Settings },
];

const ALL_ITEMS: NavItem[] = [...PAGE_ITEMS, ...PERSONAL_ITEMS];

/** Narrow web keeps Logjam GPS's tab bar — Map · Places · Logs · Ways · More —
 *  so a user who knows one knows the other. `Map` is not a page (it closes the
 *  open one), so it is not in this list. */
const NARROW_TAB_IDS: NavItemId[] = ["places", "logs", "ways"];

/** The More menu, most- to least-reached. Inbox first: it is the badged item,
 *  and landing on it is what makes More's badge pay off in one glance. */
const MORE_ITEM_IDS: NavItemId[] = ["inbox", "maps", "friends", "account", "settings"];

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
    railItems: NARROW_TAB_IDS.map(itemById),
    moreItems: MORE_ITEM_IDS.map(itemById),
    spacerAfterIndex: null,
  };
}

/** Total badge count across the given items. Drives More's badge. */
export function aggregateBadgeCount(items: NavItem[], counts: NavBadgeCounts): number {
  return items.reduce((sum, item) => sum + (counts[item.id] ?? 0), 0);
}

/** True when the open panel lives inside More, so More reads as selected. */
export function isPanelInMore(moreItems: NavItem[], activePanel: PanelId | null): boolean {
  return moreItems.some((item) => item.id === activePanel);
}

/** "Inbox, 3 unread" — the badge is aria-hidden, so its count joins the name. */
export function labelWithBadge(label: string, count: number): string {
  return count > 0 ? `${label}, ${count} unread` : label;
}

export const NAV_ITEMS_FOR_TEST = { ALL_ITEMS, PAGE_ITEMS, PERSONAL_ITEMS };

import {
  Layers,
  Map,
  MapPin,
  Mountain,
  BookOpen,
  BarChart3,
  Users,
  Bell,
  CircleUser,
} from "lucide-react";
import type { PanelId } from "./panels";

/** Panels reachable from the nav. `canyon-detail` is opened programmatically
 *  (from the map / canyon list), never from a nav item, so it isn't one. */
export type NavItemId = Exclude<PanelId, "canyon-detail">;

export type NavItem = {
  id: NavItemId;
  label: string;
  Icon: typeof Layers;
};

/** Unread/attention counts keyed by the item they belong to. A count of 0 or an
 *  absent key means "no badge".
 *
 *  Adding a second badged item is one key here plus one line at the App call
 *  site — `More`'s aggregate badge and the in-sheet per-item badges both fall
 *  out of this map with no change to NavRail. (`friends` is the likely next
 *  one: App.tsx already loads `friendRequests` for the Friends panel.) */
export type NavBadgeCounts = Partial<Record<NavItemId, number>>;

/** Feature panels — the desktop rail's top group. */
const TOP_ITEMS: NavItem[] = [
  { id: "layers", label: "Layers", Icon: Layers },
  { id: "canyons", label: "Canyons", Icon: MapPin },
  { id: "geopdfs", label: "GeoPDFs", Icon: Map },
  { id: "lidar", label: "LiDAR", Icon: Mountain },
  { id: "trip-logs", label: "Trip Logs", Icon: BookOpen },
  { id: "analytics", label: "Analytics", Icon: BarChart3 },
  { id: "friends", label: "Friends", Icon: Users },
];

/** Personal/status panels — the desktop rail's bottom group, below the spacer. */
const BOTTOM_ITEMS: NavItem[] = [
  { id: "notifications", label: "Alerts", Icon: Bell },
  { id: "account", label: "Account", Icon: CircleUser },
];

const ALL_ITEMS: NavItem[] = [...TOP_ITEMS, ...BOTTOM_ITEMS];

/** The three panels that stay on the rail at phone widths, in rail order.
 *  Chosen as the surfaces used *during* a trip: what's on the map, which canyon,
 *  and logging it. Everything else is planning, review, or admin. */
const MOBILE_RAIL_IDS: NavItemId[] = ["layers", "canyons", "trip-logs"];

/** Order of the More sheet, most- to least-reachable.
 *
 *  - `notifications` first: it is the only badged item today and the reason the
 *    sheet is acceptable at all — landing on it means More's badge pays off in
 *    one glance rather than a scan.
 *  - `friends` / `analytics` next: read-only review surfaces, cheap to open.
 *  - `geopdfs` / `lidar` last of the features: frontend/CLAUDE.md calls the
 *    heavy authoring tools desktop-first, so they rank lowest on a phone.
 *  - `account` last, preserving the desktop rail's bottom-group convention. */
const MORE_ITEM_IDS: NavItemId[] = [
  "notifications",
  "friends",
  "analytics",
  "geopdfs",
  "lidar",
  "account",
];

function itemById(id: NavItemId): NavItem {
  const item = ALL_ITEMS.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`No nav item registered for panel "${id}"`);
  return item;
}

export type NavPartition = {
  /** Rendered directly on the rail. */
  railItems: NavItem[];
  /** Rendered inside the More sheet. Empty on desktop, where More isn't shown. */
  moreItems: NavItem[];
  /** Desktop renders a flex spacer between the top and bottom groups. */
  spacerAfterIndex: number | null;
};

/** Split the nav into rail items and More-sheet items.
 *
 *  Desktop keeps every item on the rail: the rail is vertical and ~492px of
 *  items has room to spare, so More would cost a click and buy nothing. At
 *  phone widths the rail is a horizontal strip and nine items measure 484px
 *  against a 390px viewport, so six of them move into More. */
export function partitionNavItems(isMobile: boolean): NavPartition {
  if (!isMobile) {
    return {
      railItems: ALL_ITEMS,
      moreItems: [],
      spacerAfterIndex: TOP_ITEMS.length - 1,
    };
  }
  return {
    railItems: MOBILE_RAIL_IDS.map(itemById),
    moreItems: MORE_ITEM_IDS.map(itemById),
    spacerAfterIndex: null,
  };
}

/** Total badge count across the given items. Drives More's badge: More is
 *  badged whenever anything inside it is. */
export function aggregateBadgeCount(items: NavItem[], counts: NavBadgeCounts): number {
  return items.reduce((sum, item) => sum + (counts[item.id] ?? 0), 0);
}

/** True when the open panel lives inside More, so More reads as the selected
 *  rail item. `canyon-detail` isn't a nav item and selects nothing. */
export function isPanelInMore(moreItems: NavItem[], activePanel: PanelId | null): boolean {
  return moreItems.some((item) => item.id === activePanel);
}

export const NAV_ITEMS_FOR_TEST = { ALL_ITEMS, TOP_ITEMS, BOTTOM_ITEMS };

// Places, the tick list: Logjam Web's `PlacesPanel.tsx` and Logjam GPS's
// `places/PlacesScreen.tsx`.
//
// Declared elsewhere and read by both, not copied here: the status buckets
// and their order (`PLACE_STATUS_ORDER`, `PLACE_STATUS_LABELS`), the sorts
// (`PLACE_SORT_OPTIONS`), a row's second line (`placeSummary`).
import type { IconIdea } from "../icons.js";
import { placeSortLabel } from "../placeFilterOptions.js";
import type { PlaceSortKey } from "../placeFilter.js";
import type { PlaceStatus } from "../placeStatus.js";
import type { ContractPlatform, ScreenContract } from "./types.js";

export const PLACES_LIST = {
  id: "places.list",
  question: "How far through my list am I?",
  title: "Places",
  sections: [
    { key: "hero" },
    // Two rails, in this order: what kind of place, then where it is in the
    // tick list. Only the status rail gives way to the selection bar.
    { key: "typeRail" },
    { key: "statusRail" },
    // Filters the user cannot see announce themselves, with the way out.
    { key: "filterNote" },
    {
      key: "listHead",
      on: "web",
      reason:
        "It carries the keyboard's range-selection hint, which a touch screen has no use for. Logjam GPS names a sort that is not the default in the filter note instead.",
    },
    {
      key: "truncated",
      on: "web",
      reason:
        "Only Logjam Web lists straight from the server's capped response. Logjam GPS lists the mirror that sync fills.",
    },
    { key: "list" },
  ],
  copy: {
    typeRail: "Place type",
    statusRail: "Status",
    // "Any type", not "All": the status rail under it has its own "All".
    anyType: "Any type",
    newType: "New type",
    allStatuses: "All",

    search: "Search places",
    searchField: "Search by name or alternative name",
    searchPlaceholder: "Name or alternative name",
    closeSearch: "Close search",
    clearFilters: "Clear filters",
    sortByNameAgain: "Sort by name again",
    loading: "Loading your places…",

    firstRunTitle: "No places yet",
    // The first-run body names the ways in, and they differ: Logjam Web
    // imports, Logjam GPS does not, and a guest's places never sync.
    firstRunBodyWeb:
      "Add a place on the map, or bring your list in from a file or RopeWiki. Places you add here reach Logjam GPS for offline use.",
    firstRunBodyGps:
      "Add places, or import your list on Logjam Web. Once synced, they work offline.",
    firstRunBodyGuest:
      "Add places to start. Everything is saved on this phone and works offline.",
    filteredTitle: "No places match",
    filteredBody:
      "Nothing matches your search and filters. Clear them to see the rest.",
    todoTitle: "Your list is clear",
    todoBody:
      "You've logged a trip for every place. Add a new place and it appears here.",
    doneTitle: "Nothing visited yet",
    doneBody: "Log a trip at a place and it moves here.",
    sharedTitle: "Nothing shared with you",
    sharedBody:
      "Places a friend shares appear here with notes and photos. Share your own from a place's page.",
  },
} as const satisfies ScreenContract;

/**
 * The ways to add a place, in menu order. Logjam Web draws a menu; Logjam GPS
 * has one way in, so it draws that entry as a button (a step that asks
 * nothing is skipped).
 */
export const PLACES_ADD = {
  id: "places.list.add",
  title: "Add",
  sections: [
    { key: "add" },
    {
      key: "importFile",
      on: "web",
      reason:
        "Logjam GPS has no place importer. Its first-run empty state sends the user to Logjam Web.",
    },
    {
      key: "importRopewiki",
      on: "web",
      reason:
        "Logjam GPS has no place importer. Its first-run empty state sends the user to Logjam Web.",
    },
  ],
  copy: {
    add: "Add a place",
    importFile: "Import from file",
    importRopewiki: "Import from RopeWiki",
    importingRopewiki: "Importing from RopeWiki…",
    menu: "Add places",
  },
} as const satisfies ScreenContract;

/** The glyph of each way in, the same idea on both clients. Exhaustive by
 *  type, so an entry cannot be added without one. */
export const PLACES_ADD_ICON: Record<
  (typeof PLACES_ADD)["sections"][number]["key"],
  IconIdea
> = {
  add: "addPlace",
  importFile: "upload",
  importRopewiki: "saveOffline",
};

/** "1 place", "37 places". */
export function placesCountLabel(count: number): string {
  return `${count} ${count === 1 ? "place" : "places"}`;
}

/**
 * Logjam GPS's hero: the size of the whole collection, whatever is filtered.
 * Logjam Web's hero is `PLACES_LIST.title`: its chips already show the counts.
 */
export function placesHeroTitle(count: number): string {
  return count === 0 ? PLACES_LIST.copy.firstRunTitle : placesCountLabel(count);
}

/**
 * The filter note: how many filters the user cannot see, then a sort that is
 * not the default. Null when there is nothing to announce.
 */
export function placesFilterNote(
  hiddenFilterCount: number,
  sort: PlaceSortKey,
): string | null {
  const parts = [
    hiddenFilterCount > 0
      ? `${hiddenFilterCount} ${hiddenFilterCount === 1 ? "filter" : "filters"} active`
      : null,
    sort !== "name" ? placeSortLabel(sort) : null,
  ].filter((part): part is string => part != null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export type PlacesEmptyKind = "firstRun" | "filtered" | PlaceStatus;

/**
 * Which empty state an empty list is. An empty collection, an over-tight
 * filter and an exhausted bucket are different problems with different ways
 * out. A type tab with nothing behind it is "filtered": the user is looking
 * at nothing and Clear filters is the way back to everything.
 */
export function placesEmptyKind(args: {
  /** Places in the whole collection, shared ones included. */
  total: number;
  /** A search or a filter the sheet owns is set. */
  filtering: boolean;
  bucket: "all" | PlaceStatus;
}): PlacesEmptyKind {
  if (args.total === 0) return "firstRun";
  if (args.filtering || args.bucket === "all") return "filtered";
  return args.bucket;
}

/** The way out an empty state offers: add a place, clear the filters, or none. */
export type PlacesEmptyAction = "add" | "clear" | null;

export function placesEmptyState(
  kind: PlacesEmptyKind,
  viewer: { platform: ContractPlatform; guest?: boolean },
): {
  icon: IconIdea;
  title: string;
  body: string;
  action: PlacesEmptyAction;
} {
  const copy = PLACES_LIST.copy;
  switch (kind) {
    case "firstRun":
      return {
        icon: "place",
        title: copy.firstRunTitle,
        body:
          viewer.platform === "web"
            ? copy.firstRunBodyWeb
            : viewer.guest
              ? copy.firstRunBodyGuest
              : copy.firstRunBodyGps,
        action: "add",
      };
    case "filtered":
      return {
        icon: "filter",
        title: copy.filteredTitle,
        body: copy.filteredBody,
        action: "clear",
      };
    case "todo":
      return {
        icon: "place",
        title: copy.todoTitle,
        body: copy.todoBody,
        action: "add",
      };
    case "done":
      return {
        icon: "success",
        title: copy.doneTitle,
        body: copy.doneBody,
        action: null,
      };
    case "shared":
      return {
        icon: "friends",
        title: copy.sharedTitle,
        body: copy.sharedBody,
        action: null,
      };
  }
}

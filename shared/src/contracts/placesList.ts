// Places, the tick list: Logjam Web's `PlacesPanel.tsx` and Logjam GPS's
// `places/PlacesScreen.tsx`.
//
// Declared elsewhere and read by both, not copied here: the sorts
// (`PLACE_SORT_OPTIONS`), a row's second line (`placeSummary`).
import type { IconIdea } from "../icons.js";
import type { Region } from "../regions.js";
import { placeSortLabel } from "../placeFilterOptions.js";
import type { PlaceSortKey } from "../placeFilter.js";
import type { ClientOnly, ContractPlatform, ScreenContract } from "./types.js";

export const PLACES_LIST = {
  id: "places.list",
  question: "How far through my list am I?",
  title: "Places",
  sections: [
    { key: "hero" },
    // One rail: what kind of place. The selection bar takes its place.
    { key: "typeRail" },
    // Hidden with nothing to search, and disabled during a selection.
    { key: "search" },
    // Filters the user cannot see announce themselves, with the way out.
    { key: "filterNote" },
    {
      key: "listHead",
      on: "web",
      reason:
        "It carries the keyboard's range-selection hint, which a touch screen can't use. Logjam GPS names a sort that is not the default in the filter note instead.",
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
    anyType: "All",
    newType: "New type",

    search: "Search places",
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
        "Importing a spreadsheet is desk work: the file is on a computer. Logjam GPS's first-run empty state sends the user to Logjam Web.",
    },
    {
      key: "importRopewiki",
      on: "web",
      reason:
        "Importing a spreadsheet is desk work: the file is on a computer. Logjam GPS's first-run empty state sends the user to Logjam Web.",
    },
  ],
  copy: {
    add: "Add a place",
    importFile: "Import from CSV",
    importRopewiki: "Import from RopeWiki",
    importingRopewiki: "Importing from RopeWiki…",
    menu: "Add places",
  },
} as const satisfies ScreenContract;

/**
 * The canyon-list import, one offer per chosen region with a source
 * (`canyonRegionsOf`): in the first-run dialog and the Add menu. With one
 * region the menu entry needs no name.
 */
export const ROPEWIKI_OFFER = {
  title: (region: Region) =>
    `Load the ${region.name} place database (RopeWiki)`,
  hint: (region: Region) =>
    `Recommended — hundreds of ${region.name} canyons, so your trips have something to match against`,
  menu: (region: Region, offers: number) =>
    offers > 1
      ? `Import ${region.name} from RopeWiki`
      : PLACES_ADD.copy.importRopewiki,
  confirmBody: (region: Region) =>
    `This fetches the public ${region.name} canyon list from ropewiki.com and adds any canyons you don't already have, updating RopeWiki-sourced ones you haven't edited. Canyons that look like ones you already have are set aside for you to review before they're imported. Nothing you've edited is overwritten.`,
};

/**
 * The first-run dialog offering to load the place database or import the
 * user's own files. Not a menu entry, so not a `PLACES_ADD` section.
 */
export const PLACES_ONBOARDING = [
  {
    id: "welcomeDialog",
    on: "web",
    reason:
      "Loading RopeWiki and importing files is desk work, like the imports in the Add menu. Logjam GPS's first-run empty state sends the user to Logjam Web for it.",
  },
] as const satisfies readonly ClientOnly[];

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
 * Empty it is "0 places", so the first-run empty state's "No places yet" is
 * the only line saying so.
 * Logjam Web's hero is `PLACES_LIST.title`.
 */
export function placesHeroTitle(count: number): string {
  return placesCountLabel(count);
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

/**
 * Whether a place type gets a tab on the type rail.
 *
 * A built-in earns its tab with its first place: a canyoner is not offered a
 * Campsite tab they have never used. A type the user made has one from the
 * moment it exists, empty or not: they made it on purpose, and a type that
 * shows up nowhere after "Type added." reads as a save that failed.
 */
export function placeTypeHasTab(type: {
  builtIn: boolean;
  /** Places of this type in the whole collection, not the filtered view. */
  places: number;
}): boolean {
  return !type.builtIn || type.places > 0;
}

export type PlacesEmptyKind = "firstRun" | "filtered";

/** An empty collection and an over-tight filter are different problems with
 *  different ways out. A type tab with nothing behind it is "filtered". */
export function placesEmptyKind(args: { total: number }): PlacesEmptyKind {
  return args.total === 0 ? "firstRun" : "filtered";
}

/** The way out an empty state offers: add a place, clear the filters. */
export type PlacesEmptyAction = "add" | "clear";

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
  if (kind === "filtered")
    return {
      icon: "filter",
      title: copy.filteredTitle,
      body: copy.filteredBody,
      action: "clear",
    };
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
}

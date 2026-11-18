// The logbook: Logjam Web's `TripLogsPanel.tsx` and Logjam GPS's
// `logs/LogsScreen.tsx`, and the sheet behind their filter button. Stats is
// the other view of the logbook and is its own surface.
//
// Declared elsewhere and read by both, not copied here: the sorts
// (`TRIP_SORT_OPTIONS`), the date presets (`datePresets`) and a row's trip
// verbs (`TRIP_VERBS`).
import type { IconIdea } from "../icons.js";
import { TRIP_SORT_OPTIONS, type TripSortKey } from "../tripFilter.js";
import { navLabel } from "./nav.js";
import type { ClientOnly, ContractPlatform, ScreenContract } from "./types.js";
import { plural, t } from "../i18n.js";

export const TRIPS_LIST = {
  id: "logs.list",
  question: t`What have I done?`,
  title: navLabel("logs"),
  sections: [
    { key: "hero" },
    // One rail: what kind of trip. The selection bar takes its place.
    { key: "typeRail" },
    // Hidden with nothing to search, and disabled during a selection.
    { key: "search" },
    // Filters the user cannot see announce themselves, with the way out.
    { key: "filterNote" },
    {
      key: "truncated",
      on: "web",
      reason: t`Only Logjam Web lists straight from the server's capped response. Logjam GPS lists the mirror that sync fills.`,
    },
    { key: "list" },
  ],
  copy: {
    typeRail: t`Trip type`,
    allTypes: t`All`,
    noType: t`No type`,

    search: t`Search trips`,
    stats: t`Trip stats`,
    clearFilters: t`Clear filters`,
    loading: t`Loading your trips…`,

    firstRunTitle: t`No trips yet`,
    // The first-run body names the ways in, and they differ: Logjam Web
    // imports, Logjam GPS does not, and a guest's trips never sync.
    firstRunBodyWeb: t`Log a trip, or bring your trips in from a file. Trips you log here reach Logjam GPS for offline use.`,
    firstRunBodyGps: t`Log a trip, or import your trips on Logjam Web. Once synced, it works offline.`,
    firstRunBodyGuest: t`Log a trip to start. Everything is saved on this phone and works offline.`,
    filteredTitle: t`No trips match`,
    filteredBody: t`Nothing matches your search and filters. Clear them to see the rest.`,

    hasNotes: t`Has notes`,
  },
} as const satisfies ScreenContract;

/** The ways to add a trip, in menu order. Logjam Web draws a menu; Logjam GPS
 *  has one way in, so it draws that entry as a button. */
export const TRIPS_ADD = {
  id: "logs.list.add",
  title: t`Add`,
  sections: [
    { key: "add" },
    {
      key: "importFile",
      on: "web",
      reason: t`Importing a spreadsheet is desk work: the file is on a computer. Logjam GPS's first-run empty state sends the user to Logjam Web.`,
    },
  ],
  copy: {
    add: t`Log a trip`,
    importFile: t`Import from CSV`,
    menu: t`Add trips`,
  },
} as const satisfies ScreenContract;

export const TRIPS_ADD_ICON: Record<
  (typeof TRIPS_ADD)["sections"][number]["key"],
  IconIdea
> = {
  add: "addTrip",
  importFile: "upload",
};

export const TRIPS_FILTER_SHEET = {
  id: "logs.filterSheet",
  title: t`Sort and filter`,
  sections: [
    // The options are `TRIP_SORT_OPTIONS`.
    { key: "sort" },
    // One row per definition offered for the activity rail's selection, each
    // drawn by `attributeFilterShape`. The include-missing switch closes the
    // section, because attributes are the only thing it widens.
    { key: "attributes" },
    // The presets are `datePresets`, then the exact range.
    { key: "dates" },
  ],
  copy: {
    sort: t`Sort`,
    attributes: t`Attributes`,
    dates: t`Dates`,

    // Each client's `switchCopy.test.ts` ("keeps to the limit") holds a switch's
    // label and hint to `SWITCH_COPY_MAX`.
    includeMissing: t`Include if not set`,
    includeMissingHint: t`Also show ones with no value`,
    tripDate: t`Trip date`,
    dateFrom: t`From`,
    dateTo: t`To`,
    datePresets: t`Date presets`,
    clear: t`Clear`,
    reset: t`Reset`,
    done: t`Done`,
  },
} as const satisfies ScreenContract;

/**
 * The trip form's chip row of saved places near the ends of the track it was
 * opened from.
 */
export const TRIP_NEAR_TRACK_LABEL = t`Near this track`;

/** "1 trip", "37 trips". */
export function tripsCountLabel(count: number): string {
  return plural(count, "# trip", "# trips");
}

/**
 * Logjam GPS's hero: the size of the whole logbook, whatever is filtered.
 * Empty it is "0 trips", so the first-run empty state's "No trips yet" is the
 * only line saying so.
 * Logjam Web's hero is `TRIPS_LIST.title`: its chips already show the counts.
 */
export function tripsHeroTitle(count: number): string {
  return tripsCountLabel(count);
}

/**
 * The filter note: the date range if one is set, how many other filters the
 * user cannot see, then a sort that is not the default. Null when there is
 * nothing to announce.
 */
export function tripsFilterNote(args: {
  /** The range as words ("Last 12 months"), when one is set. */
  rangeLabel: string | null;
  /** Filters the sheet owns that are set, the range counting as one. */
  sheetFilterCount: number;
  sort: TripSortKey;
}): string | null {
  const others = args.sheetFilterCount - (args.rangeLabel != null ? 1 : 0);
  const sort = TRIP_SORT_OPTIONS.find((option) => option.key === args.sort);
  const parts = [
    args.rangeLabel,
    others > 0 ? plural(others, "# filter active", "# filters active") : null,
    args.sort !== "newest" && sort ? sort.label : null,
  ].filter((part): part is string => part != null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export type TripsEmptyKind = "firstRun" | "filtered";

/** An empty logbook and an over-tight filter are different problems with
 *  different ways out. A type tab with nothing behind it is "filtered". */
export function tripsEmptyKind(args: { total: number }): TripsEmptyKind {
  return args.total === 0 ? "firstRun" : "filtered";
}

/** The way out an empty state offers: log a trip, clear the filters. */
export type TripsEmptyAction = "add" | "clear";

export function tripsEmptyState(
  kind: TripsEmptyKind,
  viewer: { platform: ContractPlatform; guest?: boolean },
): {
  icon: IconIdea;
  title: string;
  body: string;
  action: TripsEmptyAction;
} {
  const copy = TRIPS_LIST.copy;
  if (kind === "filtered")
    return {
      icon: "filter",
      title: copy.filteredTitle,
      body: copy.filteredBody,
      action: "clear",
    };
  return {
    icon: "trip",
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

/**
 * How a selection starts and grows on every list. The bar's verbs are subsets
 * of `PLACE_VERBS` / `TRIP_VERBS`, so their web-only entries (Map, Export)
 * already carry reasons; what differs here is the gesture.
 */
export const SELECTION_GESTURES = [
  {
    id: "shiftClickRange",
    on: "web",
    reason: t`A range needs a modifier key and a pointer, and a touch screen has neither. Logjam Web's list says so under its header.`,
  },
  {
    id: "pressAndHold",
    on: "gps",
    reason: t`A finger cannot hover or hold a modifier key, so a press and hold on a row starts a selection. Logjam Web selects with its checkboxes.`,
  },
  {
    id: "selectAllButton",
    on: "gps",
    reason: t`A touch screen cannot press Ctrl+A, which is how Logjam Web selects every row.`,
  },
] as const satisfies readonly ClientOnly[];

/** The selection bar's count, on every list: "3 selected". The list's own
 *  noun is already on screen. */
export function listSelectionLabel(count: number): string {
  return t`${count} selected`;
}

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
import type { ContractPlatform, ScreenContract } from "./types.js";

export const TRIPS_LIST = {
  id: "logs.list",
  question: "What have I done?",
  title: navLabel("logs"),
  sections: [
    // Also holds the way into `TRIPS_TO_LOG`: a button, shown above zero.
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
      reason:
        "Only Logjam Web lists straight from the server's capped response. Logjam GPS lists the mirror that sync fills.",
    },
    { key: "list" },
  ],
  copy: {
    typeRail: "Trip type",
    allTypes: "All",
    noType: "No type",

    search: "Search trips",
    stats: "Trip stats",
    clearFilters: "Clear filters",
    loading: "Loading your trips…",

    firstRunTitle: "No trips yet",
    // The first-run body names the ways in, and they differ: Logjam Web
    // imports, Logjam GPS does not, and a guest's trips never sync.
    firstRunBodyWeb:
      "Log a trip, or bring your trips in from a file. Trips you log here reach Logjam GPS for offline use.",
    firstRunBodyGps:
      "Log a trip, or import your trips on Logjam Web. Once synced, it works offline.",
    firstRunBodyGuest:
      "Log a trip to start. Everything is saved on this phone and works offline.",
    filteredTitle: "No trips match",
    filteredBody:
      "Nothing matches your search and filters. Clear them to see the rest.",

    hasNotes: "Has notes",
  },
} as const satisfies ScreenContract;

/** The ways to add a trip, in menu order. Logjam Web draws a menu; Logjam GPS
 *  has one way in, so it draws that entry as a button. */
export const TRIPS_ADD = {
  id: "logs.list.add",
  title: "Add",
  sections: [
    { key: "add" },
    {
      key: "importFile",
      on: "web",
      reason:
        "Importing a spreadsheet is desk work: the file is on a computer. Logjam GPS's first-run empty state sends the user to Logjam Web.",
    },
  ],
  copy: {
    add: "Log a trip",
    importFile: "Import from CSV",
    menu: "Add trips",
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
  title: "Sort and filter",
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
    sort: "Sort",
    attributes: "Attributes",
    dates: "Dates",

    includeMissing: "Include if not set",
    includeMissingHint: "Also show ones with no value",
    tripDate: "Trip date",
    dateFrom: "From",
    dateTo: "To",
    datePresets: "Date presets",
    clear: "Clear",
    reset: "Reset",
    done: "Done",
  },
} as const satisfies ScreenContract;

/**
 * The recordings that have no trip on their day (`recordingsToLog`): a
 * sub-view on Logjam Web, a sheet on Logjam GPS. Each client's hero opens it
 * with a button reading `recordingsToLogLabel`, shown only above zero.
 */
export const TRIPS_TO_LOG = {
  id: "logs.toLog",
  question: "Which recordings have no trip yet?",
  title: "Recordings to log",
  sections: [
    // One line saying what the list holds, or that it is empty.
    { key: "note" },
    // A row per recording, each opening the trip form on it.
    { key: "list" },
  ],
  copy: {
    note: "Recordings from the last 30 days on a day with no trip.",
    empty: "Every recent recording has a trip.",
    // The same verb as the logbook's add button, so a rename is made once.
    verb: TRIPS_ADD.copy.add,
    // The trip form's chip row of saved places near the recording's ends.
    nearTrack: "Near this track",
  },
} as const satisfies ScreenContract;

/** "1 recording to log", "3 recordings to log". */
export function recordingsToLogLabel(count: number): string {
  return `${count} ${count === 1 ? "recording" : "recordings"} to log`;
}

/** "1 trip", "37 trips". */
export function tripsCountLabel(count: number): string {
  return `${count} ${count === 1 ? "trip" : "trips"}`;
}

/**
 * Logjam GPS's hero: the size of the whole logbook, whatever is filtered.
 * Logjam Web's hero is `TRIPS_LIST.title`: its chips already show the counts.
 */
export function tripsHeroTitle(count: number): string {
  return count === 0 ? TRIPS_LIST.copy.firstRunTitle : tripsCountLabel(count);
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
    others > 0
      ? `${others} ${others === 1 ? "filter" : "filters"} active`
      : null,
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

/** The selection bar's count, on every list: "3 selected". The list's own
 *  noun is already on screen. */
export function listSelectionLabel(count: number): string {
  return `${count} selected`;
}

// The logbook's Stats view: Logjam Web's `AnalyticsPanel.tsx` and Logjam GPS's
// `logs/StatsScreen.tsx`. Every number is `computeLogbookStats`, and the
// sentences under the tiles are `statsHeadline`, `statsCadence`,
// `activityTallySubtitle` and `fieldStatDisplay`: this holds the page around
// them. Opening an activity narrows the page to its spark, tiles and
// attributes, on both clients.
import { pluralCount } from "../logbook.js";
import { TRIPS_LIST } from "./tripLogs.js";
import type { ScreenContract } from "./types.js";

export const STATS = {
  id: "logs.stats",
  question: "How much, and of what?",
  title: "Stats",
  sections: [
    // The days out, with the window every number below is read in under it.
    { key: "hero" },
    {
      key: "truncated",
      on: "web",
      reason:
        "Only Logjam Web counts straight from the server's capped response. Logjam GPS counts the mirror that sync fills.",
    },
    { key: "spark" },
    { key: "headline" },
    { key: "activities" },
    { key: "placesVisited" },
    {
      key: "onFoot",
      on: "gps",
      reason:
        "It reads the recordings made on that phone, which Logjam Web does not have.",
    },
    { key: "attributes" },
  ],
  copy: {
    loading: TRIPS_LIST.copy.loading,
    emptyTitle: "Nothing logged in here yet",
    emptyBody:
      "Log a few trips and this fills in — days out, how often you get away, and how far you've got through your places.",
    byActivity: "By activity",
    multiTagged: "a trip with two tags counts under both",
    placesVisited: "Places visited",
    onFoot: "On foot",
    tripAttributes: "Trip attributes",
    backToActivities: "Back to every activity",
  },
} as const satisfies ScreenContract;

/** The hero: days out, the number the Logs list cannot give. */
export function statsHeroTitle(days: number): string {
  return `${pluralCount(days, "day")} out`;
}

/** An activity's window with nothing in it, and the way out. */
export function statsEmptyActivityBody(activityLabel: string): string {
  return `No ${activityLabel.toLowerCase()} trips in this window. Try a wider one.`;
}

export function statsMostReturnedLine(name: string, trips: number): string {
  return `most returned to · ${name} ×${trips}`;
}

export function statsPlaceAttributesTitle(typeName: string): string {
  return `${typeName} attributes`;
}

/** Attributes scoped to one activity show only on that activity's view. */
export function statsUnderActivitiesNote(count: number): string {
  return count === 1
    ? "1 more attribute belongs to a single activity — open that activity above to see it"
    : `${count} more attributes belong to single activities — open an activity above to see them`;
}

export function statsTruncatedNote(shown: number, total: number): string {
  return `Counted over your ${shown} most recent trips of ${total}. Older ones aren't loaded.`;
}

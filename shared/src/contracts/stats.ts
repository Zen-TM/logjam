// The logbook's Stats view: Logjam Web's `AnalyticsPanel.tsx` and Logjam GPS's
// `logs/StatsScreen.tsx`. Every number is `computeLogbookStats`, and the
// sentences under the tiles are `statsHeadline`, `statsCadence`,
// `activityTallySubtitle` and `fieldStatDisplay`: this holds the page around
// them. Opening an activity narrows the page to its spark, tiles and
// attributes, on both clients.
import { TRIPS_LIST } from "./tripLogs.js";
import type { ScreenContract } from "./types.js";
import { plural, t } from "../i18n.js";

export const STATS = {
  id: "logs.stats",
  question: t`How much, and of what?`,
  title: t`Stats`,
  sections: [
    // The days out, with the window every number below is read in under it.
    { key: "hero" },
    {
      key: "truncated",
      on: "web",
      reason: t`Only Logjam Web counts straight from the server's capped response. Logjam GPS counts the mirror that sync fills.`,
    },
    { key: "spark" },
    { key: "headline" },
    { key: "activities" },
    { key: "placesVisited" },
    {
      key: "onFoot",
      on: "gps",
      reason: t`It reads the recordings made on that phone, which Logjam Web does not have.`,
    },
    { key: "attributes" },
  ],
  copy: {
    loading: TRIPS_LIST.copy.loading,
    emptyTitle: t`Nothing logged in here yet`,
    emptyBody: t`Log a few trips and this fills in — days out, how often you get away, and how far you've got through your places.`,
    byActivity: t`By trip type`,
    multiTagged: t`a trip with two tags counts under both`,
    placesVisited: t`Places visited`,
    onFoot: t`On foot`,
    tripAttributes: t`Trip attributes`,
    backToActivities: t`Back to every trip type`,
  },
} as const satisfies ScreenContract;

/** The hero: days out, the number the Logs list cannot give. */
export function statsHeroTitle(days: number): string {
  return plural(days, "# day out", "# days out");
}

/** An activity's window with nothing in it, and the way out. */
export function statsEmptyActivityBody(activityLabel: string): string {
  return t`No ${activityLabel.toLowerCase()} trips in this window. Try a wider one.`;
}

export function statsMostReturnedLine(name: string, trips: number): string {
  return t`most returned to · ${name} ×${trips}`;
}

export function statsPlaceAttributesTitle(typeName: string): string {
  return t`${typeName} attributes`;
}

/** Attributes scoped to one activity show only on that activity's view. */
export function statsUnderActivitiesNote(count: number): string {
  return plural(
    count,
    "# more attribute belongs to a single trip type — open that trip type above to see it",
    "# more attributes belong to single trip types — open a trip type above to see them",
  );
}

export function statsTruncatedNote(shown: number, total: number): string {
  return t`Counted over your ${shown} most recent trips of ${total}. Older ones aren't loaded.`;
}

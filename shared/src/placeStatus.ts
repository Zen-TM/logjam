// Place status and row copy, shared by the Places screen on Logjam GPS and the
// Places panel on Logjam Web.
//
// A place is either one you've visited, one you haven't, or one a friend shared
// with you. Those three states are a true partition of the list — a shared
// place can never be "done", because a trip can only link to its own owner's
// places — so they double as the filter rail's buckets and as each row's
// glyph and hue.
//
// PRIVACY: every helper here reads names, grades and tallies. None of them
// touches latitude/longitude — a place's position never reaches a list row.
import { formatCanyonGrade } from "./canyonGrade.js";
import { numericFieldValue } from "./fieldValues.js";

export type PlaceStatus = "done" | "todo" | "shared";

/** Rail and row labels. The glyph is per client (Feather vs lucide). "Visited"
 *  rather than "Done": the measure is one logged trip and nothing more, so a
 *  bailed descent counts — and it reads on a campsite, which "Done" did not. */
export const PLACE_STATUS_LABELS: Record<PlaceStatus, string> = {
  done: "Visited",
  todo: "Not visited",
  shared: "Shared",
};

/** Rail order: the question the list answers, then the friend's places. */
export const PLACE_STATUS_ORDER: readonly PlaceStatus[] = ["todo", "done", "shared"];

/**
 * `tripCount` is the viewer's OWN linked-trip count. On a place shared with the
 * viewer it is structurally zero (they cannot link a trip to someone else's
 * place), and the owner's tally never reaches them — so "shared" wins over any
 * count.
 */
export function placeStatus(
  place: { syncRole: "owner" | "shared" },
  tripCount: number,
): PlaceStatus {
  if (place.syncRole === "shared") return "shared";
  return tripCount > 0 ? "done" : "todo";
}

/** Structural, so both a mirror row and an API place satisfy it. */
export type PlaceSummaryFields = {
  fieldValues?: unknown;
};

/**
 * Capped at three facts, in priority order: a fourth doesn't fit a row beside
 * the rating and the overflow button, and ellipsising mid-number ("3 abse…")
 * tells the reader less than leaving it out.
 */
const SUMMARY_FACTS = 3;

/**
 * The row's second line: what you'd want to know before committing a Saturday.
 * Grade first (the shorthand every canyoner reads first), then the two
 * logistics numbers that decide whether today is the day — how long, and
 * whether your rope reaches. Only states what is known: a place with no grades
 * gets a short line, or "", rather than a row of "—" placeholders.
 */
export function placeSummary(place: PlaceSummaryFields): string {
  const hours = numericFieldValue(place.fieldValues, "hours");
  const longest = numericFieldValue(place.fieldValues, "longest_abseil");
  const abseils = numericFieldValue(place.fieldValues, "num_abseils");
  return [
    formatCanyonGrade(place.fieldValues),
    hours != null ? `${trimNumber(hours)} h` : null,
    longest != null ? `${trimNumber(longest)} m max` : null,
    abseils != null ? `${abseils} abseils` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .slice(0, SUMMARY_FACTS)
    .join(" · ");
}

/** Quality as a compact rating, e.g. "★ 4". Null when unrated — an absent
 * rating is not a zero-star one. */
export function qualityLabel(quality: number | null | undefined): string | null {
  if (quality == null) return null;
  return `★ ${trimNumber(quality)}`;
}

/** 4 not "4.0", but 3.5 stays 3.5 — grades and hours are stored as floats. */
function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

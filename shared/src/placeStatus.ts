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
 *  bailed descent counts — and it applies to campsites as well. */
export const PLACE_STATUS_LABELS: Record<PlaceStatus, string> = {
  done: "Visited",
  todo: "Not visited",
  shared: "Shared",
};

/**
 * What anything a friend shared with the viewer says about whose it is: a
 * place, a way, a place page. The owner's name when it is known; never the bare
 * "Shared", which a row on the owner's side also says of what they gave away.
 */
export function incomingLabel(owner: string | null | undefined): string {
  return owner ? `From ${owner}` : "Shared with you";
}

/** Rail order: the question the list answers, then the friend's places. */
export const PLACE_STATUS_ORDER: readonly PlaceStatus[] = [
  "todo",
  "done",
  "shared",
];

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
  notes?: string | null;
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
 * gets a short line rather than a row of "—" placeholders. A place with none
 * of those facts (a campsite, a car park) shows the first line of its notes
 * instead, so a list of them is not a list of identical type words; "" only
 * when it has neither.
 */
export function placeSummary(place: PlaceSummaryFields): string {
  const hours = numericFieldValue(place.fieldValues, "hours");
  const longest = numericFieldValue(place.fieldValues, "longest_abseil");
  const abseils = numericFieldValue(place.fieldValues, "num_abseils");
  const facts = [
    formatCanyonGrade(place.fieldValues),
    hours != null ? `${trimNumber(hours)} h` : null,
    longest != null ? `${trimNumber(longest)} m max` : null,
    abseils != null ? `${abseils} abseils` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .slice(0, SUMMARY_FACTS)
    .join(" · ");
  return facts || firstNotesLine(place.notes);
}

/** Notes are uncapped user text; a row shows a glance of them, not a page. */
const NOTES_LINE_MAX = 80;

/** The first line with words in it, without the Markdown marker that opens it
 *  (a `#`, `>` or bullet followed by a space: "-33.86" is not one), cut to
 *  `NOTES_LINE_MAX` characters. */
function firstNotesLine(notes: string | null | undefined): string {
  for (const line of (notes ?? "").split("\n")) {
    const text = line.replace(/^\s*(?:#{1,6}|>|[-*+])\s+/, "").trim();
    if (!text) continue;
    return text.length > NOTES_LINE_MAX
      ? `${text.slice(0, NOTES_LINE_MAX - 1).trimEnd()}…`
      : text;
  }
  return "";
}

/** Quality as a compact rating, e.g. "★ 4". Null when unrated — an absent
 * rating is not a zero-star one. */
export function qualityLabel(
  quality: number | null | undefined,
): string | null {
  if (quality == null) return null;
  return `★ ${trimNumber(quality)}`;
}

/** 4 not "4.0", but 3.5 stays 3.5 — grades and hours are stored as floats. */
function trimNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Math.round(value * 10) / 10);
}

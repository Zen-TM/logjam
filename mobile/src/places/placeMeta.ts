// Place identity and row copy for the Places screen.
//
// The screen's organising idea is a tick list: a place is either one you've
// run, one you haven't, or one a friend shared with you. Those three states are
// a true partition of the list — a shared place can never be "done", because a
// trip can only link to its own owner's places — so they double as the filter
// rail's buckets and as the per-row glyph/hue (DESIGN.md §3).
//
// PRIVACY: every helper here reads names, grades and tallies. None of them
// touches latitude/longitude — a place's position never reaches a list row
// (DESIGN.md §11).
import type { Feather } from "@expo/vector-icons";
import { formatCanyonGrade, numericFieldValue } from "@logjam/shared";

import { placeHue } from "../theme";

export type PlaceStatus = "done" | "todo" | "shared";

export type PlaceStatusMeta = {
  /** Rail chip label. */
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  hue: string;
};

export const PLACE_STATUS_META: Record<PlaceStatus, PlaceStatusMeta> = {
  done: { label: "Done", icon: "check-circle", hue: placeHue.done },
  todo: { label: "To do", icon: "map-pin", hue: placeHue.todo },
  shared: { label: "Shared", icon: "users", hue: placeHue.shared },
};

/**
 * `tripCount` is the viewer's OWN linked-trip count, derived locally from the
 * mirrored trip logs. On a place shared with the viewer it is structurally
 * zero (they cannot link a trip to someone else's place), and the owner's
 * tally never reaches this device — so "shared" wins over any count.
 */
export function placeStatus(
  place: { syncRole: "owner" | "shared" },
  tripCount: number,
): PlaceStatus {
  if (place.syncRole === "shared") return "shared";
  return tripCount > 0 ? "done" : "todo";
}

/** Structural, so both a mirror row and an API place satisfy it. Everything
 *  the summary needs is in `fieldValues` now, under the reserved keys. */
export type PlaceSummaryFields = {
  fieldValues?: unknown;
};

/**
 * The row's second line: what you'd want to know before committing a Saturday.
 * Grade first (it is the shorthand every placeer reads first), then the two
 * logistics numbers that decide whether today is the day — how long, and
 * whether your rope reaches.
 *
 * Only states what is known. A place imported with no grades gets a short
 * line rather than a row of "—" placeholders.
 *
 * Capped at three facts, in priority order: a fourth doesn't fit a row beside
 * the rating and the overflow button, and ellipsising mid-number ("3 abse…")
 * tells the reader less than leaving it out.
 */
const SUMMARY_FACTS = 3;

export function placeSummary(place: PlaceSummaryFields): string {
  // A place of a type that carries none of these summarises to "", and the row
  // shows its name alone — the same thing an ungraded canyon has always done,
  // now with no special case for the type that has no grades at all.
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

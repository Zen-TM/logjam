// Trip-log naming + trip-type vocabulary. A trip's title defaults to the
// joined names of its linked canyons ("Claustral, Ranon and Whungee Whengee");
// the join lives here so api and frontend can never drift. displayName, when
// set, always overrides the derived name.

export const TRIP_NAME_MAX_LENGTH = 200;
export const TRIP_TYPE_MAX_LENGTH = 40;
export const MAX_CANYONS_PER_TRIP = 20;
export const MAX_TRIP_TYPES_PER_TRIP = 10;

/**
 * The trip type that a canyon link implies. Lowercase — it is the canonical
 * casing this codebase writes; user-typed case variants ("Canyoning") are
 * matched case-insensitively and never rewritten.
 */
export const CANYONING_TRIP_TYPE = "canyoning";

/**
 * Built-in trip-type suggestions. The UI unions these with the distinct types
 * from the user's own trip history — free text is always allowed, so this is
 * a seed vocabulary, not an enum.
 */
export const TRIP_TYPE_SUGGESTIONS = [
  "canyoning",
  "bushwalking",
  "bikepacking",
  "packrafting",
] as const;

/**
 * Join canyon names into the default trip title: "A", "A and B",
 * "A, B and C". Returns null for an empty list — callers fall back to their
 * own placeholder ("Untitled trip"). Never inline this join elsewhere.
 */
export function formatTripCanyonNames(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Linking a canyon to a trip means "I completed that canyon on that trip", so a
 * canyon-linked trip is a canyoning trip. This derives the type list to persist
 * from the user's own list plus that rule — the single derivation, called by the
 * API (POST/PATCH /trips), the seed, and TripLogDialog, so the tag the dialog
 * shows is exactly the tag the server stores.
 *
 * Force-add only, never force-remove: unlinking the last canyon leaves an
 * existing `canyoning` tag alone, because a canyon-less trip may legitimately be
 * canyoning ("I did a canyon that isn't in my library").
 *
 * Returns `types` unchanged (same reference) when it has nothing to add, so
 * callers can cheaply detect a no-op.
 */
export function enforceCanyoningTag(
  types: string[],
  hasLinkedCanyon: boolean,
): string[] {
  if (!hasLinkedCanyon) return types;
  // Case-insensitive: the API rejects case-insensitive duplicates, so pushing
  // "canyoning" onto ["Canyoning"] would build a list its own validator 400s.
  // The user's casing wins.
  if (types.some((t) => t.toLowerCase() === CANYONING_TRIP_TYPE)) return types;
  // Best-effort: at the cap, skip the tag rather than exceed it.
  //
  // This silent skip is deliberate, and is the one place this repo's "fail
  // loudly, no silent fallbacks" rule is waived. Justification: analytics
  // filters canyoning trips by canyon LINK (OR tag), so the tag is never
  // load-bearing — a 10-type canyon trip missing `canyoning` is still counted
  // correctly in every stat; it is merely absent from the trip-list type
  // filter. Rare and trivial.
  //
  // The alternative — letting the system tag exceed the cap — is what makes
  // this a bug: storing 11 types means reopening the dialog PATCHes all 11
  // back and the request 400s ("At most 10 types per trip"), so the trip
  // becomes uneditable. The system would have created a row its own validator
  // rejects. Do not turn this skip into a throw, and do not raise the cap:
  // `types` is a user-controlled unbounded String[] and the cap is a mandatory
  // input bound (SEC-001), sibling to TRIP_NAME_MAX_LENGTH / MAX_CANYONS_PER_TRIP.
  if (types.length >= MAX_TRIP_TYPES_PER_TRIP) return types;
  return [...types, CANYONING_TRIP_TYPE];
}

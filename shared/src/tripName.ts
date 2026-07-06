// Trip-log naming + trip-type vocabulary. A trip's title defaults to the
// joined names of its linked canyons ("Claustral, Ranon and Whungee Whengee");
// the join lives here so api and frontend can never drift. displayName, when
// set, always overrides the derived name.

export const TRIP_NAME_MAX_LENGTH = 200;
export const TRIP_TYPE_MAX_LENGTH = 40;
export const MAX_CANYONS_PER_TRIP = 20;

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

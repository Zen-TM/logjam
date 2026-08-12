// What a tagged waypoint looks like, in the one place both clients read.
//
// The COLOUR lives here because a carpark that is blue on the phone and green
// in the browser is the kind of drift nobody notices until they are comparing
// two screens in the field. The GLYPH does not: mobile draws Feather icons and
// the web draws lucide ones, and neither name resolves on the other platform —
// so each keeps its own icon map keyed by these same tags.
//
// Unknown tags are the normal case (the vocabulary is open, see
// WAYPOINT_TAG_SUGGESTIONS), and they take the default. That is why this is a
// lookup with a fallback rather than an enum.

/** Tag (lowercased) → marker colour. */
const TAG_COLORS: Record<string, string> = {
  abseil: "#C7B39A",
  campsite: "#9DBE8B",
  carpark: "#86B5D4",
  exit: "#9DBE8B",
};

/** Waratah — the warmest hue in the palette, for a point with nothing to say
 *  about itself. A waypoint is a thing you are trying to FIND again. */
export const DEFAULT_WAYPOINT_COLOR = "#D4715E";

/**
 * The colour for a waypoint: its explicit `symbol` if it has one, else its
 * FIRST tag, else the default.
 *
 * First tag rather than any matching tag so the answer is stable — a waypoint
 * tagged `water, carpark` must not change colour when the table grows a `water`
 * entry.
 */
export function waypointColor(waypoint: {
  symbol?: string | null;
  tags?: readonly string[];
}): string {
  const key = waypoint.symbol ?? waypoint.tags?.[0];
  if (!key) return DEFAULT_WAYPOINT_COLOR;
  return TAG_COLORS[key.toLowerCase()] ?? DEFAULT_WAYPOINT_COLOR;
}

/** The tags that have a colour of their own — for a client's own icon map to
 *  key against, so the two lists cannot drift apart silently. */
export const COLORED_WAYPOINT_TAGS = Object.keys(TAG_COLORS);

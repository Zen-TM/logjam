// What a waypoint LOOKS like, derived rather than chosen.
//
// The `symbol` column has existed since the waypoint model landed and nothing
// ever wrote it. Rather than adding a second picker to a sheet that already
// asks for tags, the glyph and hue fall out of the tags the user already set:
// a waypoint tagged `carpark` gets the car. An explicit `symbol` still wins, so
// the column keeps its meaning as an override for anything a tag can't say.
//
// Unknown tags are the normal case — the vocabulary is open — and they get the
// default pin. That is the whole reason this is a lookup with a fallback and
// not an enum.
import type { Feather } from "@expo/vector-icons";
import { DEFAULT_WAYPOINT_COLOR, waypointColor } from "@logjam/shared";

type Glyph = React.ComponentProps<typeof Feather>["name"];

/** Tag (lowercased) → glyph. COLOURS ARE NOT HERE: they live in shared
 *  (waypointTags.ts) so the phone and the browser paint a carpark the same,
 *  which a screenshot comparison in the field would otherwise expose. Feather
 *  names only resolve on this platform, so the glyph stays local. */
const TAG_GLYPHS: Record<string, Glyph> = {
  abseil: "arrow-down",
  campsite: "home",
  carpark: "truck",
  exit: "log-out",
};

export const DEFAULT_WAYPOINT_SYMBOL = {
  icon: "map-pin" as Glyph,
  color: DEFAULT_WAYPOINT_COLOR,
};

/**
 * The glyph and hue for one waypoint: its explicit `symbol` if it has one,
 * else its FIRST tag, else the default pin. First tag rather than any matching
 * tag so the answer is stable — a waypoint tagged `water, hazard` must not
 * change colour when the lookup table grows an entry.
 */
export function waypointSymbol(waypoint: {
  symbol?: string | null;
  tags?: readonly string[];
}): { icon: Glyph; color: string } {
  const key = waypoint.symbol ?? waypoint.tags?.[0];
  const glyph = key ? TAG_GLYPHS[key.toLowerCase()] : undefined;
  return {
    icon: glyph ?? DEFAULT_WAYPOINT_SYMBOL.icon,
    color: waypointColor(waypoint),
  };
}

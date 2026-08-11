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

import { assetHue } from "../theme";

type Glyph = React.ComponentProps<typeof Feather>["name"];

/** Tag (lowercased) → how it draws. Only the seeded vocabulary is here; a tag
 *  the user invents renders as the default pin until it earns an entry. */
const TAG_SYMBOLS: Record<string, { icon: Glyph; color: string }> = {
  carpark: { icon: "truck", color: "#86B5D4" },
  campsite: { icon: "home", color: "#9DBE8B" },
  water: { icon: "droplet", color: "#86B5D4" },
  anchor: { icon: "anchor", color: "#C7B39A" },
  abseil: { icon: "arrow-down", color: "#C7B39A" },
  exit: { icon: "log-out", color: "#9DBE8B" },
  hazard: { icon: "alert-triangle", color: "#D98F3D" },
  lookout: { icon: "eye", color: "#B79EC0" },
};

export const DEFAULT_WAYPOINT_SYMBOL = {
  icon: "map-pin" as Glyph,
  color: assetHue.waypoint,
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
  if (!key) return DEFAULT_WAYPOINT_SYMBOL;
  return TAG_SYMBOLS[key.toLowerCase()] ?? DEFAULT_WAYPOINT_SYMBOL;
}

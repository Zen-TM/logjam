import type { Feather } from "@expo/vector-icons";

import { theme } from "../theme";

/**
 * TRIP TYPE IDENTITY — glyph + hue per activity.
 *
 * Trip types are an OPEN vocabulary (`TRIP_TYPE_SUGGESTIONS` is a seed list and
 * free text is always allowed), so unlike `assetHue` this can't be an
 * exhaustive map. Two rules keep it coherent:
 *
 * 1. The seeded activities get a fixed identity, so `canyoning` is always the
 *    scheme accent — the same "the main class feels native to the theme" rule
 *    `assetHue.region` follows.
 * 2. Anything user-typed gets a hue derived from the LABEL, not its position in
 *    a list. A per-index colour would repaint every custom type the moment
 *    another one sorts ahead of it; hashing the label means "vertical caving"
 *    is the same colour tomorrow, and on the user's other device.
 *
 * Same palette rule as `assetHue`: mid-light, muted, NSW-derived. Never a
 * saturated web primary.
 */
type TripTypeMeta = { icon: React.ComponentProps<typeof Feather>["name"]; hue: string };

const SEEDED: Record<string, TripTypeMeta> = {
  canyoning: { icon: "droplet", hue: theme.accent },
  bushwalking: { icon: "trending-up", hue: "#9DBE8B" },
  bikepacking: { icon: "navigation", hue: "#C97B4A" },
  packrafting: { icon: "anchor", hue: "#86B5D4" },
};

/** Hues for user-typed activities, indexed by a hash of the label. */
const OPEN_VOCABULARY_HUES = [
  "#B79EC0", // heath flower
  "#C9B37B", // dry grass
  "#8FBFAE", // lichen
  "#D3A0A0", // waratah, muted
  "#A9B4CE", // distant ridge
] as const;

/** The glyph for a trip with no type at all. */
const UNTYPED: TripTypeMeta = { icon: "book-open", hue: theme.bonus1 };

function hashLabel(label: string): number {
  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function tripTypeMeta(type: string | null | undefined): TripTypeMeta {
  if (!type) return UNTYPED;
  const seeded = SEEDED[type.toLowerCase()];
  if (seeded) return seeded;
  return {
    icon: "tag",
    hue: OPEN_VOCABULARY_HUES[hashLabel(type.toLowerCase()) % OPEN_VOCABULARY_HUES.length],
  };
}

/**
 * The type that represents a whole trip in a list: its first, which is the
 * user's own ordering. `enforceCanyoningTag` appends the implied `canyoning`
 * tag last, so first stays "what the user called this trip".
 */
export function primaryTripType(types: string[]): string | null {
  return types[0] ?? null;
}

/**
 * Display casing for a trip type. Stored values are the user's own text (and
 * the canonical `canyoning` is lowercase by convention), so capitalisation is
 * presentation only — never write this back, or a case-variant duplicate is
 * exactly what the API rejects.
 */
export function tripTypeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

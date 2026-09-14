import { ASSET_HUES, TRIP_TYPE_OPEN_HUES } from "./designTokens.js";

/**
 * TRIP TYPE IDENTITY — glyph + hue per activity, for both clients.
 *
 * Trip types are an OPEN vocabulary (`TRIP_TYPE_SUGGESTIONS` is a seed list and
 * free text is always allowed), so unlike a place type this can't be a stored
 * choice. Two rules keep it coherent:
 *
 * 1. The seeded activities get a fixed identity, and the canonical one
 *    (`canyoning`) takes the scheme's accent — the main class feels native to
 *    the theme, as a downloaded region does.
 * 2. Anything user-typed gets a hue derived from the LABEL, not its position in
 *    a list. A per-index colour would repaint every custom type the moment
 *    another one sorts ahead of it; hashing the label means "vertical caving"
 *    is the same colour tomorrow, and in the other client.
 *
 * The hue is a scheme ROLE where the scheme decides it (`accent`, `untyped`)
 * and a fixed colour otherwise; each client resolves the role to its own theme
 * value. The glyph is a key each client maps into its own icon set (Feather on
 * the phone, lucide on the web), exactly as a place type's `iconKey` is.
 */

/** Every glyph a trip type can wear. Guarded on the web by
 *  `frontend/src/tripTypeIcons.test.ts`; Feather's type checks the phone. */
export const TRIP_TYPE_ICON_KEYS = [
  "droplet",
  "trending-up",
  "navigation",
  "anchor",
  "tag",
  "book-open",
] as const;

export type TripTypeIconKey = (typeof TRIP_TYPE_ICON_KEYS)[number];

export type TripTypeHue = "accent" | "untyped" | (string & {});

export type TripTypeIdentity = { icon: TripTypeIconKey; hue: TripTypeHue };

const SEEDED: Record<string, TripTypeIdentity> = {
  canyoning: { icon: "droplet", hue: "accent" },
  bushwalking: { icon: "trending-up", hue: ASSET_HUES.overlay },
  bikepacking: { icon: "navigation", hue: ASSET_HUES.geoPdf },
  packrafting: { icon: "anchor", hue: ASSET_HUES.import },
};

const OPEN_HUES = Object.values(TRIP_TYPE_OPEN_HUES);

/** A trip with no type at all. */
const UNTYPED: TripTypeIdentity = { icon: "book-open", hue: "untyped" };

function hashLabel(label: string): number {
  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function tripTypeIdentity(type: string | null | undefined): TripTypeIdentity {
  if (!type) return UNTYPED;
  const seeded = SEEDED[type.toLowerCase()];
  if (seeded) return seeded;
  return { icon: "tag", hue: OPEN_HUES[hashLabel(type.toLowerCase()) % OPEN_HUES.length] };
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

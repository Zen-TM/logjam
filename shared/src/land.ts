// The Land overlay: who holds the land, from a region's land archive
// (`RegionTerrain.land`, regions.ts); NSW's is the NSW Land Tenure layer. Its
// build keeps the source's one attribute, so a class is the source's own word
// for it, and the region lists them with what a person reads and their colour.
//
// It answers who holds the land, not whether anyone may go there: no dataset
// answers that, so neither a name nor a colour here says "allowed" or "no
// access", and none is red or a traffic-light green.
import type { LandArchive } from "./regions.js";

/**
 * Land tenure draws from this zoom in. It is what someone standing at a fence
 * wants, not someone looking at a region, and further out a tile holds up to
 * 340,000 points, too many to stroke on a phone.
 */
export const LAND_EDGE_MINZOOM = 12;

/**
 * What a saved area keeps of the archive: the zooms a map draws. The rest stay
 * for a print at a coarse scale, and a z8 tile weighs what 100 z13 ones do.
 */
export function landClip<Land extends { minzoom: number }>(
  land: Land,
): Omit<Land, "minzoom"> & { minzoom: number } {
  return { ...land, minzoom: LAND_EDGE_MINZOOM };
}

/**
 * A holding's border, bottom of the map first: two soft lines and a sharp one.
 * Each is its holding's colour and pushed inside its own polygon by `offset`
 * (a tile's rings wind so that positive is inwards), so two holdings meet as
 * two colours, each fading into its own side. Pixels.
 */
export const LAND_EDGE_LINES = [
  { width: 8, offset: 4, blur: 4, opacity: 0.25 },
  { width: 5, offset: 2.5, blur: 2.5, opacity: 0.35 },
  { width: 1.5, offset: 0.75, blur: 0, opacity: 0.9 },
] as const;

/**
 * How far a tile's polygons run past its edge, in pixels: the build script's
 * `BUFFER` (test_land_tenure.py). A line pushed in further than this from the
 * edge they're cut at would draw the tile grid (land.test.ts).
 */
export const LAND_TILE_MARGIN_PX = 10;

/** How far past `LAND_EDGE_MINZOOM` the lines take to fade in. */
const LAND_FADE_ZOOMS = 0.75;

/** The `line-opacity` expression of one of `LAND_EDGE_LINES`. */
export function landEdgeOpacity(opacity: number): unknown[] {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    LAND_EDGE_MINZOOM,
    0,
    LAND_EDGE_MINZOOM + LAND_FADE_ZOOMS,
    opacity,
  ];
}

/** The `line-color` expression: a class's colour. */
export function landColor(land: LandArchive): unknown[] {
  return [
    "match",
    ["get", land.classProperty],
    ...land.classes.flatMap((c) => [c.source, c.colour]),
    "rgba(0,0,0,0)",
  ];
}

/** A feature's class, from its `classProperty`, or undefined if it is no class. */
export function landClass(land: LandArchive, value: unknown) {
  return land.classes.find((c) => c.source === value);
}

/**
 * The name "What is here?" gives the land at a point, from what a map's own
 * query found on its land layer there, or null. Neither client asks anyone
 * else: a tap reads the tile already on the device.
 */
export function landNameOf(
  land: LandArchive,
  features: readonly { properties?: Record<string, unknown> | null }[],
): string | null {
  return (
    landClass(land, features[0]?.properties?.[land.classProperty])?.name ?? null
  );
}

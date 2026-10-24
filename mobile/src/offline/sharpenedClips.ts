// What a saved area keeps of each sharpened area it reaches: the area's
// heights (read by the offline sampler, and shaded as the hillshade), its
// slope and its contours. Each is cut by byte range from the area's own
// archive, through the presigned URL the account's list gives, over the part
// of the area the saved area covers. Offline, the map routes them as it does
// online, one archive per tile (sourceResolver.ts `routeTerrain`).
//
// PRIVACY: a presigned URL is a bearer credential and an area's range says
// where its owner surveyed. This file is pure: no I/O, so nothing to log.
import {
  SHARPENED_ARCHIVE_URL,
  SHARPENED_SOURCE_PREFIX,
  TERRAIN_ARCHIVE_LAYERS,
  type RegionBbox,
  type SharpenedOverlay,
  type TerrainArchiveLayer,
} from "@logjam/shared";

import { tileRectCovering, type TileRect } from "../map/terrainRoutes";
import type { RegionClipSpec } from "./regionDownloads";

/** One clip of one area's archive, as a `RegionClipSpec` carries it. */
export type AreaClip = {
  id: string;
  layer: TerrainArchiveLayer;
  url: string;
  zmax: 16 | 17;
  /** The z15 tiles saved, inclusive: whole z14 tiles, inside `tiles15`. */
  tiles: TileRect;
};

/**
 * The part of an area a saved area covers, as z15 tiles widened to whole
 * z14 tiles (so the contours, routed by z14 tile, line up with it), or null
 * where the two don't meet.
 */
export function areaRangeIn(
  area: Pick<SharpenedOverlay, "tiles15">,
  bbox: RegionBbox,
): TileRect | null {
  const [x0, y0, x1, y1] = tileRectCovering(15, [
    bbox.west,
    bbox.south,
    bbox.east,
    bbox.north,
  ]);
  const t = area.tiles15;
  const range = [
    Math.max(x0 & ~1, t[0]),
    Math.max(y0 & ~1, t[1]),
    Math.min(x1 | 1, t[2]),
    Math.min(y1 | 1, t[3]),
  ] as const;
  return range[0] <= range[2] && range[1] <= range[3] ? range : null;
}

const LABEL: Record<TerrainArchiveLayer, string> = {
  heights: "Sharpened heights",
  slope: "Sharpened slope",
  contours: "Sharpened contours",
};

/** The clips of every area `bbox` reaches; none for an area it misses. */
export function areaClipSpecs(
  run: Pick<
    RegionClipSpec,
    "bbox" | "groupId" | "groupLabel" | "allowCellular"
  >,
  areas: readonly SharpenedOverlay[],
  newId: () => string,
): ({ taskKind: "clip" } & RegionClipSpec)[] {
  return areas.flatMap((area) => {
    const tiles = areaRangeIn(area, run.bbox);
    if (!tiles) return [];
    return TERRAIN_ARCHIVE_LAYERS.flatMap((layer) => {
      const url = area[SHARPENED_ARCHIVE_URL[layer]];
      if (!url) return [];
      return [
        {
          taskKind: "clip" as const,
          id: newId(),
          basemapId: `${SHARPENED_SOURCE_PREFIX}${area.id}`,
          label: LABEL[layer],
          ...run,
          area: { id: area.id, layer, url, zmax: area.zmax, tiles },
        },
      ];
    });
  });
}

/**
 * Bytes per z15 tile (about 1 km² in NSW), from the lab's figures for
 * surveyed ground: 2 m is about 0.2 MB of heights and 0.18 MB of slope a
 * km², 1 m about 0.6 and 0.77. The 5 m fill around a survey compresses
 * better, so these lean high. Contours are measured on the published
 * Katoomba areas, about 14 KB a z15 tile.
 */
const AREA_TILE_BYTES: Record<16 | 17, Record<TerrainArchiveLayer, number>> = {
  16: { heights: 206_000, slope: 185_000, contours: 20_000 },
  17: { heights: 617_000, slope: 792_000, contours: 20_000 },
};

/** What the clips of the areas `bbox` reaches add to the download. */
export function areaClipBytes(
  areas: readonly SharpenedOverlay[],
  bbox: RegionBbox,
): number {
  return areas.reduce((sum, area) => {
    const tiles = areaRangeIn(area, bbox);
    if (!tiles) return sum;
    const count = (tiles[2] - tiles[0] + 1) * (tiles[3] - tiles[1] + 1);
    const per = AREA_TILE_BYTES[area.zmax];
    return (
      sum +
      count * (per.heights + per.slope + (area.contoursUrl ? per.contours : 0))
    );
  }, 0);
}

/**
 * Whether a save may go ahead, as far as the account's areas go: a guest has
 * none to wait for; a signed-in save waits for the list, and says so when it
 * failed, rather than saving no sharpened terrain without a word.
 */
export function areasForSave(
  signedIn: boolean,
  list: { data: unknown; loading: boolean; error: string | null },
): "none" | "loading" | "failed" | "ready" {
  if (!signedIn) return "none";
  if (list.error != null) return "failed";
  return list.loading || list.data == null ? "loading" : "ready";
}

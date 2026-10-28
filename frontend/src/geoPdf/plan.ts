// What a GeoPDF reads, worked out from its config alone: the map's size and
// zooms, and the DEM tiles each strip reads. Pure; nothing here touches the
// network.
import {
  computeTileToMapTransform,
  computeZoom,
  geoPdfMaxNativeZoom,
  NSW_HILLSHADE,
  NSW_SLOPE,
  TARGET_DPI,
  type SharpenedOverlay,
  type TileCoord,
  type TileToMapTransform,
} from "@logjam/shared";
import {
  demBlockRows,
  terrainReadZoom,
  terrainTileReader,
  terrainTileReads,
  type TerrainTileRead,
} from "./terrain";
import type { GeoPdfRenderInput } from "./types";

/** The map's size and the zooms it is drawn and read at. */
export function printGeometry(config: GeoPdfRenderInput["config"]) {
  const { north, south, east, west } = config.extent;
  const centreLat = (north + south) / 2;
  const zoom = computeZoom(
    config.scale,
    centreLat,
    TARGET_DPI,
    geoPdfMaxNativeZoom(config.baseLayer),
  );
  const probe = computeTileToMapTransform(zoom, north, south, east, west, 1, 1);
  return {
    centreLat,
    zoom,
    nativeW: Math.round(probe.srcW),
    nativeH: Math.round(probe.srcH),
    // Overlays are read as deep as the print allows whatever the sheet is.
    overlayZoom: computeZoom(config.scale, centreLat, TARGET_DPI, 18),
  };
}
export type PrintGeometry = ReturnType<typeof printGeometry>;

/** The DEM tiles one layer reads, per strip. */
export type TerrainBlocks = {
  demZoom: number;
  t: TileToMapTransform;
  cols: number;
  rows: number;
  read: (z: number, x: number, y: number) => TerrainTileRead;
  /** Per span: the DEM tile rows it draws from (halo included) and its reads. */
  blocks: { r0: number; r1: number; reads: TerrainTileRead[] }[];
};

/**
 * The tiles a heights or slope layer reads for each span of map rows (a
 * strip's drawn rows), in the DEM block `demBlockRows` gives it.
 */
export function planTerrainBlocks(
  config: GeoPdfRenderInput["config"],
  g: PrintGeometry,
  areas: readonly SharpenedOverlay[],
  archiveLayer: "heights" | "slope",
  spans: readonly { from: number; to: number }[],
): TerrainBlocks {
  const { north, south, east, west } = config.extent;
  const maxzoom =
    archiveLayer === "heights" ? NSW_HILLSHADE.maxzoom : NSW_SLOPE.maxzoom;
  const demZoom = terrainReadZoom(
    Math.min(g.zoom, g.overlayZoom),
    maxzoom,
    areas,
  );
  const t = computeTileToMapTransform(
    demZoom,
    north,
    south,
    east,
    west,
    g.nativeW,
    g.nativeH,
  );
  const last = t.tiles[t.tiles.length - 1]!;
  const cols = last.x - t.minTileX + 1;
  const rows = last.y - t.minTileY + 1;
  const read = terrainTileReader(areas, archiveLayer);
  const blocks = spans.map((span) => {
    const { r0, r1 } = demBlockRows(span.from, span.to, t, rows);
    const tiles: TileCoord[] = [];
    for (let r = r0; r <= r1; r++)
      for (let c = 0; c < cols; c++)
        tiles.push({ z: demZoom, x: t.minTileX + c, y: t.minTileY + r });
    // Heights are stretched up from an ancestor (smooth); slope is not.
    return {
      r0,
      r1,
      reads: terrainTileReads(tiles, demZoom, read, archiveLayer === "heights"),
    };
  });
  return { demZoom, t, cols, rows, read, blocks };
}

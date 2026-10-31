// What a GeoPDF reads from the statewide archives, worked out from its
// config alone. The renderer plans its strips from the same functions, and the
// dialog's background prefetch (prefetch.ts) asks the same question before any
// render, so both name the same tiles. Pure; nothing here touches the network.
import {
  BASEMAP_CATALOG,
  computeTileToMapTransform,
  computeZoom,
  geoPdfMaxNativeZoom,
  NSW_CONTOURS,
  NSW_LAND,
  NSW_HILLSHADE,
  NSW_SLOPE,
  TARGET_DPI,
  type SharpenedOverlay,
  type TileCoord,
  type TileToMapTransform,
} from "@logjam/shared";
import {
  areasOnPage,
  contourTilesBySource,
  demBlockRows,
  nswVectorZoom,
  overlaysDrawn,
  STATEWIDE,
  terrainReadZoom,
  terrainTileReader,
  terrainTileReads,
  type TerrainTileRead,
} from "./terrain";
import { displayZoomForScale } from "./draw/common";
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

/**
 * The archive and tiles a vector base is read from, or null for a raster base.
 * The tile zoom follows the style zoom it is drawn at, not the print's: more
 * pixels on the page do not put more features in a tile.
 */
export function vectorBasemap(
  config: GeoPdfRenderInput["config"],
  g: PrintGeometry,
) {
  const entry = BASEMAP_CATALOG.find(
    (e) => e.id === config.baseLayer && e.kind === "vector",
  );
  if (!entry) return null;
  const { north, south, east, west } = config.extent;
  const styleZoom = displayZoomForScale(config.scale, g.centreLat);
  const zoom = Math.floor(Math.min(styleZoom, entry.maxNativeZoom));
  return {
    path: entry.urlTemplate,
    styleZoom,
    transform: computeTileToMapTransform(
      Math.max(zoom, 0),
      north,
      south,
      east,
      west,
      g.nativeW,
      g.nativeH,
    ),
  };
}

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

/** A read of a statewide archive: its path under the origin, and the tile. */
export type StatewideRead = {
  path: string;
  z: number;
  x: number;
  y: number;
};

/**
 * Every statewide tile a render of this config reads, each once: the vector
 * base, the heights for the hillshade, the slope, the contours. Reads an area serves are left
 * out (they are presigned, never prefetched). The whole map is one span: the
 * strips' blocks overlap by their halo and together cover exactly that.
 */
export function statewideReads(input: GeoPdfRenderInput): StatewideRead[] {
  const { config } = input;
  const g = printGeometry(config);
  if (!(g.nativeW > 0 && g.nativeH > 0)) return [];
  const areas = areasOnPage(input.areas, config.extent);
  const drawn = overlaysDrawn(config);
  const out = new Map<string, StatewideRead>();
  const add = (path: string, r: TileCoord) =>
    out.set(`${path} ${r.z}/${r.x}/${r.y}`, { path, ...r });
  const basemap = vectorBasemap(config, g);
  if (basemap)
    for (const tile of basemap.transform.tiles) add(basemap.path, tile);
  const whole = [{ from: 0, to: g.nativeH }];
  const layers: [boolean, "heights" | "slope"][] = [
    [drawn.hillshade, "heights"],
    [config.overlays.includes("slope"), "slope"],
  ];
  for (const [wanted, archiveLayer] of layers) {
    if (!wanted) continue;
    const path =
      archiveLayer === "heights"
        ? NSW_HILLSHADE.archivePath
        : NSW_SLOPE.archivePath;
    for (const r of planTerrainBlocks(config, g, areas, archiveLayer, whole)
      .blocks[0]!.reads)
      if (r.source === STATEWIDE) add(path, r);
  }
  const contourZoom = nswVectorZoom(
    NSW_CONTOURS,
    config.scale,
    g.centreLat,
    g.overlayZoom,
  );
  if (contourZoom !== null && drawn.contours) {
    const { north, south, east, west } = config.extent;
    const t = computeTileToMapTransform(
      contourZoom,
      north,
      south,
      east,
      west,
      g.nativeW,
      g.nativeH,
    );
    const tiles = contourTilesBySource(areas, t.tiles).get(STATEWIDE) ?? [];
    for (const tile of tiles) add(NSW_CONTOURS.archivePath, tile);
  }
  const landZoom = nswVectorZoom(
    NSW_LAND,
    config.scale,
    g.centreLat,
    g.overlayZoom,
  );
  if (landZoom !== null && config.overlays.includes("land")) {
    const { north, south, east, west } = config.extent;
    const t = computeTileToMapTransform(
      landZoom,
      north,
      south,
      east,
      west,
      g.nativeW,
      g.nativeH,
    );
    for (const tile of t.tiles) add(NSW_LAND.archivePath, tile);
  }
  return [...out.values()];
}

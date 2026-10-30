// MapSourceResolver — pure resolution of logical map layers to concrete tile
// sources. Every tile source on the mobile map flows through here, so later
// stages (offline downloads, imports) change *data* (the artifacts registry),
// never the map screen.
//
// Policy (shared/DESIGN.md):
//  - Full-coverage artifacts (topo overlays, imports): local-first ALWAYS once
//    downloaded — connectivity flaps never remount a mid-place overlay.
//  - Subset-coverage artifacts (basemap regions): remote online, local
//    region(s) offline.
//  - OSM-family basemaps are online-only by policy; offline they resolve to
//    "unavailable" and the picker greys them out.
//
// Privacy: artifacts carry region bboxes (place-area coordinates). Never log
// a MapArtifact path or bbox; resolver results carry no bbox provenance
// beyond the bounds MapLibre needs.
import {
  BASEMAP_CATALOG,
  NSW_CONTOURS,
  NSW_5M,
  NSW_HILLSHADE,
  NSW_SLOPE,
  type BasemapCatalogEntry,
  SHARPENED_SOURCE_PREFIX,
  TERRAIN_ROUTED_FROM,
  type SharpenedArea,
  type SharpenedOverlay,
  type TerrainArchiveLayer,
  type TopoLayerFormat,
  type TopoLayerKey,
} from "@logjam/shared";

import {
  sharpenedArchiveAddress,
  terrainRoutes,
  tileRectBounds,
  tileRectCovering,
  type TileRect,
} from "./terrainRoutes";
import type { TileJson } from "./tileJsonFile";

export type BasemapId =
  | "protomaps"
  | "six-topo"
  | "six-base"
  | "six-imagery"
  | "osm-topo"
  | "osm-cycle";

export type LogicalLayerRef =
  | { kind: "basemap"; basemapId: BasemapId }
  | {
      kind: "topo-overlay";
      jobId: string;
      layer: TopoLayerKey;
      format: TopoLayerFormat;
      /** Presigned pmtiles URL from /topo-jobs/completed-overlays (null if expired). */
      remoteUrl: string | null;
      attribution?: string;
    }
  /** The statewide contour lines (`shared/src/nswContours.ts`). */
  | { kind: "nsw-contours" }
  /** The Terrain group's statewide slope and hillshade (`shared/src/terrain.ts`).
   * `viewport` picks the one clip drawn offline. */
  | { kind: "nsw-slope"; viewport?: Viewport | null }
  | { kind: "nsw-hillshade"; viewport?: Viewport | null }
  | { kind: "geopdf-import"; importId: string }
  | { kind: "vector-import"; importId: string };

export type ResolvedTileSource =
  | {
      status: "ok";
      /** Stable identity — React key for the source component; change ⇔ remount. */
      key: string;
      /** `raster-dem`: a terrarium DEM, which MapLibre draws itself. */
      sourceType: "vector" | "raster" | "raster-dem";
      url?: string;
      tiles?: string[];
      tileSize?: number;
      minZoom?: number;
      maxZoom?: number;
      bounds?: [west: number, south: number, east: number, north: number];
      /** Read from a TileJSON the phone writes, in place of `url` (tileJsonFile.ts). */
      tileJson?: TileJson;
      /** The zooms its layers draw at, where they don't draw at every zoom. */
      layerMinZoom?: number;
      layerMaxZoom?: number;
      attribution?: string;
      origin: "remote" | "local";
    }
  | {
      status: "unavailable";
      key: string;
      reason: "offline-not-downloaded" | "online-only-source" | "no-remote-url";
    };

export interface MapArtifact {
  id: string;
  /**
   * `dem-region` is the odd one out: the worldwide terrarium clips are never
   * resolved to a tile source, because nothing draws them. They hold the
   * terrarium tiles the elevation sampler reads offline
   * (`offline/demLookup.ts`), and exist here so they are registered, sized,
   * grouped and deleted like every other downloaded file. The `nsw-5m` clip is
   * also drawn, as the Terrain group's hillshade (`holdsHillshade`).
   */
  kind:
    | "basemap-region"
    | "dem-region"
    /** A clip of the statewide contours, saved with the basemap they draw on. */
    | "contours-region"
    /** A clip of the statewide slope, saved the same way. */
    | "slope-region"
    | "topo-overlay"
    | "geopdf-import"
    | "vector-import";
  /** basemapId | "<jobId>/<layer>" | importId */
  logicalKey: string;
  format: "pmtiles" | "mbtiles";
  sourceType: "vector" | "raster" | "raster-dem";
  /** Absolute app-private path, backup-excluded. */
  path: string;
  bbox: [number, number, number, number] | null;
  minzoom: number | null;
  maxzoom: number | null;
  sizeBytes: number;
  downloadedAt: string;
  /**
   * User's display rename for the Saved tab (optional — absent on artifacts
   * built outside the registry). Display only: resolution keys off
   * `logicalKey`, never this.
   */
  label?: string | null;
  /**
   * The download run this came from — one "Save maps offline" tap covering one
   * area with several basemaps. Saved groups its cards by this; `groupLabel` is
   * the name the user gave that area. Both absent on artifacts that predate
   * grouping (and on imports), which then stand alone. Display only, like
   * `label`: resolution keys off `logicalKey`.
   */
  groupId?: string | null;
  groupLabel?: string | null;
}

export interface ResolveContext {
  connectivity: "online" | "offline" | "forced-offline";
  artifacts: MapArtifact[];
  /** e.g. TOPO_CDN_BASE_URL — protomaps archive + glyph/sprite host. */
  cdnBaseUrl: string;
  /**
   * The sharpened areas the user can see, from completed-overlays: online,
   * the Terrain group reads each one's own archive inside it.
   */
  sharpenedAreas?: readonly SharpenedOverlay[];
  /**
   * The account's kept areas (offline/sharpenedAreaStore.ts): offline, the
   * Terrain group reads the clips saved of them.
   */
  keptSharpenedAreas?: readonly SharpenedArea[];
}

const RASTER_TILE_SIZE = 256;
/** Matches TILE_SIZE in shared/src/geoPdfImport/tilePlan.ts. */
const GEOPDF_TILE_SIZE = 512;

// Deterministic non-cryptographic hash for source keys (djb2). A rotated
// presigned URL yields a new key → remount → native re-fetch, which is the
// only reliable update path in the wrapper.
export function hashKey(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function catalogEntry(basemapId: string): BasemapCatalogEntry | undefined {
  return BASEMAP_CATALOG.find((entry) => entry.id === basemapId);
}

function localArtifactSource(
  artifact: MapArtifact,
  logicalId: string,
  attribution?: string,
): ResolvedTileSource {
  const uri =
    artifact.format === "pmtiles"
      ? `pmtiles://file://${artifact.path}`
      : `mbtiles://${artifact.path}`;
  const key = `${logicalId}:local:${hashKey(uri)}`;
  return {
    status: "ok",
    key,
    sourceType: artifact.sourceType,
    // PMTiles rides the source `url`; MBTiles rides `tiles`.
    ...(artifact.format === "pmtiles" ? { url: uri } : { tiles: [uri] }),
    // SIX region tiles are 256; a GeoPDF import is written at 512 by the tile
    // planner. Declaring 256 for both would make MapLibre pick a tile z one level
    // deeper than it should, hitting maxZoom a level early and overzooming:
    // blurry at walking zoom.
    ...(artifact.sourceType === "raster" && {
      tileSize:
        artifact.kind === "geopdf-import" ? GEOPDF_TILE_SIZE : RASTER_TILE_SIZE,
    }),
    ...(artifact.minzoom != null && { minZoom: artifact.minzoom }),
    ...(artifact.maxzoom != null && { maxZoom: artifact.maxzoom }),
    ...(artifact.bbox != null && { bounds: artifact.bbox }),
    ...(attribution && { attribution }),
    origin: "local",
  };
}

function resolveBasemap(
  basemapId: BasemapId,
  ctx: ResolveContext,
): ResolvedTileSource[] {
  const logicalId = `basemap:${basemapId}`;
  const online = ctx.connectivity === "online";
  const regions = ctx.artifacts.filter(
    (a) => a.kind === "basemap-region" && a.logicalKey === basemapId,
  );

  if (basemapId === "protomaps") {
    // Self-hosted vector basemap. Remote archive lives on our CDN (catalog
    // urlTemplate = CDN-relative archive path); offline it needs a downloaded
    // region.
    const protomapsEntry = catalogEntry("protomaps");
    if (!protomapsEntry) {
      throw new Error("protomaps missing from BASEMAP_CATALOG");
    }
    if (online) {
      const url = `pmtiles://${ctx.cdnBaseUrl}/${protomapsEntry.urlTemplate}`;
      return [
        {
          status: "ok",
          key: `${logicalId}:remote:${hashKey(url)}`,
          sourceType: "vector",
          url,
          attribution: protomapsEntry.attribution,
          origin: "remote",
        },
      ];
    }
    if (regions.length > 0) {
      return regions.map((r) =>
        localArtifactSource(r, logicalId, protomapsEntry.attribution),
      );
    }
    return [
      {
        status: "unavailable",
        key: logicalId,
        reason: "offline-not-downloaded",
      },
    ];
  }

  const entry = catalogEntry(basemapId);
  if (!entry) {
    // Fail loudly — an unknown basemap id is a programming error, not a
    // degradable state.
    throw new Error(`Unknown basemap id: ${basemapId}`);
  }

  if (online) {
    const key = `${logicalId}:remote:${hashKey(entry.urlTemplate)}`;
    return [
      {
        status: "ok",
        key,
        sourceType: "raster",
        tiles: [entry.urlTemplate],
        tileSize: RASTER_TILE_SIZE,
        maxZoom: entry.displayMaxZoom,
        attribution: entry.attribution,
        origin: "remote",
      },
    ];
  }

  // Offline / forced-offline.
  if (!entry.offlineCapable) {
    return [
      { status: "unavailable", key: logicalId, reason: "online-only-source" },
    ];
  }
  if (regions.length > 0) {
    return regions.map((r) =>
      localArtifactSource(r, logicalId, entry.attribution),
    );
  }
  return [
    { status: "unavailable", key: logicalId, reason: "offline-not-downloaded" },
  ];
}

function resolveTopoOverlay(
  ref: Extract<LogicalLayerRef, { kind: "topo-overlay" }>,
  ctx: ResolveContext,
): ResolvedTileSource[] {
  const logicalKey = `${ref.jobId}/${ref.layer}`;
  const logicalId = `topo-overlay:${logicalKey}`;
  // Full-coverage: local-first ALWAYS — even online.
  const local = ctx.artifacts.find(
    (a) => a.kind === "topo-overlay" && a.logicalKey === logicalKey,
  );
  if (local) {
    return [localArtifactSource(local, logicalId, ref.attribution)];
  }
  if (ctx.connectivity !== "online") {
    return [
      {
        status: "unavailable",
        key: logicalId,
        reason: "offline-not-downloaded",
      },
    ];
  }
  if (!ref.remoteUrl) {
    return [{ status: "unavailable", key: logicalId, reason: "no-remote-url" }];
  }
  const url = `pmtiles://${ref.remoteUrl}`;
  return [
    {
      status: "ok",
      key: `${logicalId}:remote:${hashKey(url)}`,
      sourceType: ref.format,
      url,
      ...(ref.format === "raster" && { tileSize: RASTER_TILE_SIZE }),
      ...(ref.attribution && { attribution: ref.attribution }),
      origin: "remote",
    },
  ];
}

const boxesMeet = (
  [w1, s1, e1, n1]: readonly number[],
  [w2, s2, e2, n2]: readonly number[],
) => w1 <= e2 && w2 <= e1 && s1 <= n2 && s2 <= n1;

/** An area as routing reads it: `tiles` is the archive its TileJSON names. */
type RoutedArea = SharpenedArea & { tiles: string };

/**
 * The kind each of an area's saved clips is filed as: the statewide clip's of
 * the same layer, under the area's id. Read where clips are filed
 * (`regionClipKind`) and where the offline map looks them up.
 */
export const AREA_CLIP_KIND: Record<TerrainArchiveLayer, MapArtifact["kind"]> =
  {
    heights: "dem-region",
    slope: "slope-region",
    contours: "contours-region",
  };

/**
 * The areas saved on this phone: each clip of one of the account's kept
 * areas, its range read back from its bounds. A clip of an area no longer
 * listed (deleted or unshared) stays on disk but is not drawn.
 */
function savedAreaClips(
  ctx: ResolveContext,
  layer: TerrainArchiveLayer,
): RoutedArea[] {
  const kept = ctx.keptSharpenedAreas ?? [];
  return ctx.artifacts.flatMap((clip) => {
    if (clip.kind !== AREA_CLIP_KIND[layer] || !clip.bbox) return [];
    const area = kept.find(
      (a) => clip.logicalKey === `${SHARPENED_SOURCE_PREFIX}${a.id}`,
    );
    if (!area) return [];
    return [
      {
        ...area,
        // Each clip routes on its own: two saved areas can hold one area.
        id: clip.id,
        tiles15: tileRectCovering(15, clip.bbox),
        tiles: `pmtiles://file://${clip.path}`,
      },
    ];
  });
}

/**
 * The Terrain group where the user can see a sharpened area: the statewide
 * source up to the zoom routing starts at, then one source per
 * `terrainRoutes` rectangle, each kept to its tiles by its TileJSON's bounds
 * and read from one archive. Online, the areas are the list's, each read at
 * its fixed address (sharpenedArchives.ts). Offline, they are the area clips
 * saved on this phone, and each statewide rectangle reads every saved
 * statewide clip that reaches it. With no area, the statewide source alone as before.
 * Guard: `sourceResolver.test.ts` ("routes the Terrain group", "routes saved
 * areas offline").
 */
function routeTerrain(
  statewide: ResolvedTileSource[],
  archive: { id: string; minzoom: number; maxzoom: number; credit: string },
  layer: TerrainArchiveLayer,
  ctx: ResolveContext,
): ResolvedTileSource[] {
  const drawn = statewide.flatMap((s) =>
    s.status === "ok" && s.url ? [s] : [],
  );
  const online = drawn.some((s) => s.origin === "remote");
  if (online && drawn.length !== 1) return statewide;
  const areas: RoutedArea[] = online
    ? (ctx.sharpenedAreas ?? []).map((area) => ({
        ...area,
        tiles: `pmtiles://${sharpenedArchiveAddress(area.id, layer)}`,
      }))
    : savedAreaClips(ctx, layer);
  if (areas.length === 0) return statewide;
  const z = TERRAIN_ROUTED_FROM[layer];
  const sourceType = layer === "contours" ? "vector" : "raster-dem";
  const bounded = (
    tiles: string,
    maxzoom: number,
    rect: TileRect,
    attribution: string,
  ): ResolvedTileSource => {
    const tileJson: TileJson = {
      tiles: [tiles],
      minzoom: z,
      maxzoom,
      bounds: tileRectBounds(z, rect),
      ...(sourceType === "raster-dem" && { encoding: "terrarium" }),
    };
    return {
      status: "ok",
      key: `${archive.id}:routed:${hashKey(JSON.stringify(tileJson))}`,
      sourceType,
      tileJson,
      layerMinZoom: z,
      attribution,
      origin: online ? "remote" : "local",
    };
  };
  return [
    ...statewide.map((s) =>
      s.status === "ok" ? { ...s, layerMaxZoom: z } : s,
    ),
    ...terrainRoutes(areas, layer).flatMap((route) =>
      route.archive === "statewide"
        ? // Each saved clip only where it reaches: a clip's bounds are its
          // save's box, and the CDN's archive has none.
          drawn
            .filter(
              (s) =>
                !s.bounds ||
                boxesMeet(s.bounds, tileRectBounds(z, route.tiles)),
            )
            .map((s) =>
              bounded(
                s.url!,
                s.maxZoom ?? archive.maxzoom,
                route.tiles,
                archive.credit,
              ),
            )
        : // An area's contours are z14 alone; past its deepest zoom
          // MapLibre draws its tiles larger, as Logjam Web draws the parent.
          [
            bounded(
              route.archive.tiles,
              layer === "contours" ? z : route.archive.zmax,
              route.tiles,
              route.archive.credit,
            ),
          ],
    ),
  ];
}

/**
 * A statewide archive of Logjam's own, like the vector basemap: the CDN's
 * archive online, the clips saved of it (`clips`) offline.
 */
function resolveStatewide(
  archive: { id: string; archivePath: string; credit: string },
  sourceType: "vector" | "raster-dem",
  clips: MapArtifact["kind"] | null,
  ctx: ResolveContext,
  choose: (regions: MapArtifact[]) => MapArtifact[] = (regions) => regions,
  /** Which of the `clips` kind may be drawn (a `dem-region` holds several DEMs). */
  keep: (artifact: MapArtifact) => boolean = () => true,
): ResolvedTileSource[] {
  const logicalId = archive.id;
  if (ctx.connectivity === "online") {
    const url = `pmtiles://${ctx.cdnBaseUrl}/${archive.archivePath}`;
    return [
      {
        status: "ok",
        key: `${logicalId}:remote:${hashKey(url)}`,
        sourceType,
        url,
        attribution: archive.credit,
        origin: "remote",
      },
    ];
  }
  const regions = ctx.artifacts.filter((a) => a.kind === clips && keep(a));
  if (regions.length === 0) {
    return [
      {
        status: "unavailable",
        key: logicalId,
        reason: "offline-not-downloaded",
      },
    ];
  }
  return choose(regions).map((r) =>
    localArtifactSource(r, logicalId, archive.credit),
  );
}

/**
 * Whether a saved file can shade the Terrain group's hillshade offline: the
 * `nsw-5m` height clip, and only one that holds the shallow zooms. A clip saved
 * before `demClipMinZoom` is z15 alone, and draws nothing where the map is
 * zoomed out, so it is no clip for this: an area saved that way says "Needs a
 * connection" until it is saved again. Used by the layers sheet's switch and
 * the resolver's candidates alike, so a z15-only clip never beats a z8-15 one.
 * Guard: `sourceResolver.test.ts` ("holdsHillshade").
 */
export function holdsHillshade(
  artifact: Pick<MapArtifact, "kind" | "logicalKey" | "minzoom">,
): boolean {
  return (
    artifact.kind === "dem-region" &&
    artifact.logicalKey === NSW_5M.id &&
    artifact.minzoom != null &&
    artifact.minzoom <= NSW_HILLSHADE.minzoom
  );
}

/**
 * Whether a saved file is a clip of the statewide contours or slope, not an
 * area's own (a sharpened area's clip is filed as this kind too, under its
 * id). The layers sheet's switches and the resolver read the same test.
 * Guard: `sourceResolver.test.ts` ("holdsContours and holdsSlope").
 */
export const holdsContours = (
  artifact: Pick<MapArtifact, "kind" | "logicalKey">,
): boolean =>
  artifact.kind === "contours-region" &&
  artifact.logicalKey === NSW_CONTOURS.id;

export const holdsSlope = (
  artifact: Pick<MapArtifact, "kind" | "logicalKey">,
): boolean =>
  artifact.kind === "slope-region" && artifact.logicalKey === NSW_SLOPE.id;

/**
 * Whether a saved file is one the Terrain group can draw offline, whatever
 * its switch says.
 * Guard: `offlineMask.test.ts` ("offlineMaskBoxes").
 */
export const drawsTerrain = (
  artifact: Pick<MapArtifact, "kind" | "logicalKey" | "minzoom">,
): boolean =>
  holdsContours(artifact) || holdsSlope(artifact) || holdsHillshade(artifact);

/**
 * The one slope clip drawn offline: the saved area nearest the middle of the
 * screen, and of those holding it, the biggest, so a canyon saved inside a
 * wider area doesn't crop the slope to its own edge (before the map first
 * settles, the biggest area). A clip is whole tiles, so areas saved near each
 * other share their low-zoom tiles, and the bands are translucent: drawing
 * every clip paints those tiles twice, darker, with a seam where the overlap
 * ends.
 * Guard: `sourceResolver.test.ts` ("draws one slope clip offline", "draws the
 * wider clip where a saved area sits inside another").
 */
function nearestRegion(viewport: Viewport | null | undefined) {
  return (regions: MapArtifact[]): MapArtifact[] => {
    const lng = viewport ? (viewport.west + viewport.east) / 2 : 0;
    const lat = viewport ? (viewport.south + viewport.north) / 2 : 0;
    const perLng = Math.cos((lat * Math.PI) / 180);
    const away = ({ bbox }: MapArtifact) => {
      if (!bbox) return Number.POSITIVE_INFINITY;
      if (!viewport) return 0;
      const [west, south, east, north] = bbox;
      const dx = Math.max(west - lng, 0, lng - east) * perLng;
      const dy = Math.max(south - lat, 0, lat - north);
      return dx * dx + dy * dy;
    };
    const size = ({ bbox }: MapArtifact) =>
      bbox ? (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) : 0;
    return [...regions]
      .sort((a, b) => away(a) - away(b) || size(b) - size(a))
      .slice(0, 1);
  };
}

function resolveImport(
  ref: Extract<LogicalLayerRef, { kind: "geopdf-import" | "vector-import" }>,
  ctx: ResolveContext,
): ResolvedTileSource[] {
  const logicalId = `${ref.kind}:${ref.importId}`;
  // Imports are device-produced: always local, connectivity-independent.
  const local = ctx.artifacts.find(
    (a) => a.kind === ref.kind && a.logicalKey === ref.importId,
  );
  if (local) return [localArtifactSource(local, logicalId)];
  return [
    { status: "unavailable", key: logicalId, reason: "offline-not-downloaded" },
  ];
}

/**
 * Which of `candidates` have downloaded tiles overlapping the given viewport.
 *
 * The offline notice's evidence, and the reason it is a VIEWPORT test rather
 * than anything simpler. The resolver reports a basemap as available the moment
 * ANY region exists for it, wherever on earth — which is right for the resolver
 * (it is choosing a source, not judging coverage) and useless as a notice: a
 * saved region in one area does not provide coverage when viewing blank ground
 * in another, even though the basemap "resolved". Asking what overlaps the
 * rectangle actually on screen is the only version of the question the user is
 * asking.
 *
 * Overlap, not containment: if any part of a saved region is on screen there is
 * real map under the mask, and telling someone to switch away from it would be
 * wrong. The mask already draws where the data stops.
 */
export function basemapsCoveringViewport(
  artifacts: readonly MapArtifact[],
  viewport: Viewport,
  candidates: readonly BasemapId[],
): BasemapId[] {
  return candidates.filter((candidate) =>
    artifacts.some(
      (artifact) =>
        artifact.kind === "basemap-region" &&
        artifact.logicalKey === candidate &&
        bboxOnScreen(artifact.bbox, viewport),
    ),
  );
}

/** What the map is showing, as its settle event reports it. */
export type Viewport = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** Whether any part of `[west, south, east, north]` is on screen. */
export function bboxOnScreen(
  bbox: readonly [number, number, number, number] | null | undefined,
  viewport: Viewport,
): boolean {
  if (bbox == null) return false;
  const [west, south, east, north] = bbox;
  return (
    west <= viewport.east &&
    east >= viewport.west &&
    south <= viewport.north &&
    north >= viewport.south
  );
}

export function resolveMapSource(
  ref: LogicalLayerRef,
  ctx: ResolveContext,
): ResolvedTileSource[] {
  switch (ref.kind) {
    case "basemap":
      return resolveBasemap(ref.basemapId, ctx);
    case "topo-overlay":
      return resolveTopoOverlay(ref, ctx);
    case "nsw-contours":
      return routeTerrain(
        resolveStatewide(
          NSW_CONTOURS,
          "vector",
          "contours-region",
          ctx,
          undefined,
          holdsContours,
        ),
        NSW_CONTOURS,
        "contours",
        ctx,
      );
    case "nsw-slope":
      return routeTerrain(
        resolveStatewide(
          NSW_SLOPE,
          "raster-dem",
          "slope-region",
          ctx,
          nearestRegion(ref.viewport),
          holdsSlope,
        ),
        NSW_SLOPE,
        "slope",
        ctx,
      );
    // The saved height clip is registered as a plain raster (the sampler
    // reads its bytes); here it is drawn as the DEM it is.
    case "nsw-hillshade":
      return routeTerrain(
        resolveStatewide(
          NSW_HILLSHADE,
          "raster-dem",
          "dem-region",
          ctx,
          (regions) =>
            nearestRegion(ref.viewport)(regions).map((r) => ({
              ...r,
              sourceType: "raster-dem",
            })),
          holdsHillshade,
        ),
        NSW_HILLSHADE,
        "heights",
        ctx,
      );
    case "geopdf-import":
    case "vector-import":
      return resolveImport(ref, ctx);
  }
}

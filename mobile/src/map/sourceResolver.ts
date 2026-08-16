// MapSourceResolver — pure resolution of logical map layers to concrete tile
// sources (map-sources.md §4/§5). Every tile source on the mobile map flows
// through here, so later stages (offline downloads, imports) change *data*
// (the artifacts registry), never the map screen.
//
// Policy (§5):
//  - Full-coverage artifacts (topo overlays, imports): local-first ALWAYS once
//    downloaded — connectivity flaps never remount a mid-canyon overlay.
//  - Subset-coverage artifacts (basemap regions): remote online, local
//    region(s) offline.
//  - OSM-family basemaps are online-only by policy; offline they resolve to
//    "unavailable" and the picker greys them out.
//
// Privacy: artifacts carry region bboxes (canyon-area coordinates). Never log
// a MapArtifact path or bbox; resolver results carry no bbox provenance
// beyond the bounds MapLibre needs.
import {
  BASEMAP_CATALOG,
  type BasemapCatalogEntry,
  type TopoLayerFormat,
  type TopoLayerKey,
} from "@logjam/shared";

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
  | { kind: "geopdf-import"; importId: string }
  | { kind: "vector-import"; importId: string };

export type ResolvedTileSource =
  | {
      status: "ok";
      /** Stable identity — React key for the source component; change ⇔ remount. */
      key: string;
      sourceType: "vector" | "raster";
      url?: string;
      tiles?: string[];
      tileSize?: number;
      minZoom?: number;
      maxZoom?: number;
      bounds?: [west: number, south: number, east: number, north: number];
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
  kind: "basemap-region" | "topo-overlay" | "geopdf-import" | "vector-import";
  /** basemapId | "<jobId>/<layer>" | importId */
  logicalKey: string;
  format: "pmtiles" | "mbtiles";
  sourceType: "vector" | "raster";
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
    // PMTiles rides the source `url`; MBTiles rides `tiles` (matches the
    // spike-verified MLRN 10.4.2 behaviour).
    ...(artifact.format === "pmtiles" ? { url: uri } : { tiles: [uri] }),
    // SIX region tiles are 256; a GeoPDF import is written at 512 by the tile
    // planner. Declaring 256 for both didn't move the map — z/x/y pin the
    // geography — but it made MapLibre pick a tile z one level deeper than it
    // should, so an import hit its maxZoom a level early and overzoomed:
    // blurry at exactly the zoom a canyoner reads it at.
    ...(artifact.sourceType === "raster" && {
      tileSize:
        artifact.kind === "geopdf-import"
          ? GEOPDF_TILE_SIZE
          : RASTER_TILE_SIZE,
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
    // region (Stage 4).
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
      { status: "unavailable", key: logicalId, reason: "offline-not-downloaded" },
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
    return regions.map((r) => localArtifactSource(r, logicalId, entry.attribution));
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
  // Full-coverage: local-first ALWAYS (§5.1) — even online.
  const local = ctx.artifacts.find(
    (a) => a.kind === "topo-overlay" && a.logicalKey === logicalKey,
  );
  if (local) {
    return [localArtifactSource(local, logicalId, ref.attribution)];
  }
  if (ctx.connectivity !== "online") {
    return [
      { status: "unavailable", key: logicalId, reason: "offline-not-downloaded" },
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
 * phone with one saved Katoomba region said nothing at all while showing blank
 * ground in the Budawangs, because the basemap "resolved". Asking what overlaps
 * the rectangle actually on screen is the only version of the question the user
 * is asking.
 *
 * Overlap, not containment: if any part of a saved region is on screen there is
 * real map under the mask, and telling someone to switch away from it would be
 * wrong. The mask already draws where the data stops.
 */
export function basemapsCoveringViewport(
  artifacts: readonly MapArtifact[],
  viewport: { west: number; south: number; east: number; north: number },
  candidates: readonly BasemapId[],
): BasemapId[] {
  return candidates.filter((candidate) =>
    artifacts.some((artifact) => {
      if (artifact.kind !== "basemap-region") return false;
      if (artifact.logicalKey !== candidate) return false;
      const bbox = artifact.bbox;
      if (bbox == null) return false;
      const [west, south, east, north] = bbox;
      return (
        west <= viewport.east &&
        east >= viewport.west &&
        south <= viewport.north &&
        north >= viewport.south
      );
    }),
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
    case "geopdf-import":
    case "vector-import":
      return resolveImport(ref, ctx);
  }
}

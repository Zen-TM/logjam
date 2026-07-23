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
  | "osm"
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
}

export interface ResolveContext {
  connectivity: "online" | "offline" | "forced-offline";
  artifacts: MapArtifact[];
  /** e.g. TOPO_CDN_BASE_URL — protomaps archive + glyph/sprite host. */
  cdnBaseUrl: string;
}

const RASTER_TILE_SIZE = 256;

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
    ...(artifact.sourceType === "raster" && { tileSize: RASTER_TILE_SIZE }),
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

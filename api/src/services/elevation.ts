// DEM sampling for route/measure elevation profiles — the ONLINE reader.
//
// WHY SERVER-SIDE WHEN ONLINE. MapLibre's queryTerrainElevation only answers
// for tiles already loaded in the viewport (so a route running off-screen reads
// null), and every device would otherwise re-fetch the same tiles uncached.
// Sampling here gives one warm tile cache for web and mobile alike, and keeps
// DEM tile requests — which trace out where the user is drawing — off the
// user's own connection while they have ours to use.
//
// In Logjam GPS, a device with a downloaded region samples the same tiles
// locally, out of the MBTiles the region download wrote
// (mobile/src/offline/demLookup.ts); that path fetches the tiles direct from S3
// at download time, exactly as the raster basemap download already does. The
// choice of source, the pixel maths, the zoom and the no-data rule are shared
// so the two agree: `sampleDem` in shared/src/demSources.ts. This file is only
// the tile I/O it is handed.
//
// A sharpened area the caller may read (`visibleSharpenedAreas`) is one more
// source, finest of all, read from the job's private archive in S3 by range on
// the API's own role (ADR 0040).
//
// PRIVACY: positions passed in are precise wilderness coordinates. Nothing
// here logs a coordinate, a tile URL, a tile index or an archive key — an
// upstream failure is reported by status alone.
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { loadImage, createCanvas } from "canvas";
import { FetchSource, type PMTiles, type Source } from "pmtiles";
import {
  clearDemArchives,
  demArchive,
  demSourcesFor,
  forgetDemArchive,
  demMetresFromRgb,
  demSlopeReading,
  demTileKey,
  demTileUrl,
  readDemArchive,
  sampleDem,
  type DemSamples,
  type DemSlopeReading,
  type DemSource,
  type DemTileAddress,
  type SamplePosition,
} from "@logjam/shared";
import { getEnv } from "../lib/env";
import { logger } from "../lib/logger";
import { s3 } from "./awsClients";
import type { VisibleSharpenedArea } from "./sharpenedAreas";

const TILE_FETCH_TIMEOUT_MS = 8_000;

/**
 * Decoded tiles held in memory, keyed "source/x/y". One tile is 256×256 float
 * metres — 256 KB — so this ceiling is ~32 MB. A z15 tile is ~1.2 km across,
 * so a 20 km route crosses a few dozen. Insertion-ordered eviction (a Map iterates in
 * insertion order, so the first key is the oldest) rather than true LRU:
 * ponytail — the access pattern is a burst of neighbouring tiles per request,
 * where the two orders barely differ. Revisit only if the hit rate is measured
 * and found wanting.
 */
const MAX_CACHED_TILES = 128;
const tileCache = new Map<string, Float32Array>();

function cacheTile(key: string, tile: Float32Array) {
  if (tileCache.size >= MAX_CACHED_TILES) {
    const oldest = tileCache.keys().next();
    if (!oldest.done) tileCache.delete(oldest.value);
  }
  tileCache.set(key, tile);
}

/** Decode a terrarium PNG into a flat row-major array of metres. */
async function decodeTile(png: Uint8Array): Promise<Float32Array> {
  const image = await loadImage(Buffer.from(png));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);

  const elevations = new Float32Array(image.width * image.height);
  for (let i = 0; i < elevations.length; i++) {
    const offset = i * 4;
    elevations[i] = demMetresFromRgb(
      data[offset]!,
      data[offset + 1]!,
      data[offset + 2]!,
    );
  }
  return elevations;
}

/**
 * Fetch one tile of a public XYZ tile set.
 *
 * Returns null when the tile does not exist (outside the DEM's coverage) —
 * that is a real answer, not a failure. Anything else throws: a network blip
 * or a 500 upstream must not masquerade as "no terrain here", which would
 * silently render a flat profile over real mountains.
 */
async function fetchTile(
  source: DemSource & { urlTemplate: string },
  { tileX, tileY }: DemTileAddress,
): Promise<Uint8Array | null> {
  const response = await fetch(demTileUrl(source, tileX, tileY), {
    signal: AbortSignal.timeout(TILE_FETCH_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    // Status only — never the URL, which carries the tile index and so the
    // rough location being sampled.
    throw new Error(`DEM tile request failed with status ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * An archive on the CDN, with the timeout a tile fetch has on every range it
 * reads: the header, the directory pages and the tiles. Node's `fetch` has no
 * timeout of its own, and a stalled connection would hang the profile.
 */
function timedSource(url: string): Source {
  const inner = new FetchSource(url);
  return {
    getKey: () => inner.getKey(),
    getBytes: (offset, length, _signal, etag) =>
      inner.getBytes(
        offset,
        length,
        AbortSignal.timeout(TILE_FETCH_TIMEOUT_MS),
        etag,
      ),
  };
}

/** How long a source whose archive would not open is left alone. */
const ARCHIVE_RETRY_MS = 5 * 60_000;
const archives = new Map<string, { archive: PMTiles | null; at: number }>();

/**
 * The archive a source is read from, or null when there is none to read: no
 * `TOPO_CDN_BASE_URL`, or the archive is not there yet. That is "this source
 * has nothing", so positions fall through to the next source; it is checked
 * once and remembered, because every profile in NSW would otherwise pay for
 * the failed open. A read that fails AFTER the archive opened throws.
 */
export async function demArchiveFor(source: {
  id: string;
  archivePath: string;
}): Promise<PMTiles | null> {
  // The CDN the clients read it from too: byte ranges of our own file, which
  // say nothing a tile index would.
  const base = getEnv().TOPO_CDN_BASE_URL;
  if (!base) return null;
  const known = archives.get(source.id);
  if (known && (known.archive || Date.now() - known.at < ARCHIVE_RETRY_MS))
    return known.archive;
  let archive: PMTiles | null = demArchive(
    timedSource(`${base.replace(/\/$/, "")}/${source.archivePath}`),
  );
  try {
    await archive.getHeader();
  } catch {
    logger.warn({ demSource: source.id }, "DEM archive could not be opened");
    // Or the retry in five minutes is handed this same object, which
    // remembers that it failed and never asks the CDN again.
    forgetDemArchive(archive);
    archive = null;
  }
  archives.set(source.id, { archive, at: Date.now() });
  return archive;
}

/**
 * A job's archive in the topo bucket, read by range on the API's role, with
 * the same timeout as a CDN read. A missing archive throws: the caller was
 * told the area exists, so its absence is a failure, not "no terrain".
 */
function s3Source(key: string): Source {
  return {
    getKey: () => `s3:${key}`,
    getBytes: async (offset, length, _signal, etag) => {
      const object = await s3.send(
        new GetObjectCommand({
          Bucket: getEnv().S3_BUCKET_TOPO,
          Key: key,
          Range: `bytes=${offset}-${offset + length - 1}`,
          IfMatch: etag,
        }),
        { abortSignal: AbortSignal.timeout(TILE_FETCH_TIMEOUT_MS) },
      );
      const bytes = await object.Body!.transformToByteArray();
      return {
        data: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
        etag: object.ETag,
      };
    },
  };
}

/** The PNG bytes a source has for these tiles, however it is served. */
async function tileBytes(
  source: DemSource,
  wanted: readonly DemTileAddress[],
  areas: readonly VisibleSharpenedArea[],
): Promise<Map<string, Uint8Array>> {
  if (source.areaId != null) {
    const area = areas.find((a) => a.id === source.areaId);
    return area
      ? readDemArchive(demArchive(s3Source(area.keys.heights)), source, wanted)
      : new Map();
  }
  if (source.archivePath != null) {
    const archive = await demArchiveFor({
      ...source,
      archivePath: source.archivePath,
    });
    return archive ? readDemArchive(archive, source, wanted) : new Map();
  }
  const found = new Map<string, Uint8Array>();
  const { urlTemplate } = source;
  if (urlTemplate == null) return found;
  await Promise.all(
    wanted.map(async (address) => {
      const png = await fetchTile({ ...source, urlTemplate }, address);
      if (png) found.set(demTileKey(address), png);
    }),
  );
  return found;
}

/**
 * Each tile is fetched at most once per call, and held for the next. Tiles
 * are held under the source id, which names the job for an area.
 */
async function readTiles(
  source: DemSource,
  wanted: readonly DemTileAddress[],
  areas: readonly VisibleSharpenedArea[],
): Promise<Map<string, Float32Array>> {
  const tiles = new Map<string, Float32Array>();
  const missing: DemTileAddress[] = [];
  for (const address of wanted) {
    const cached = tileCache.get(`${source.id}/${demTileKey(address)}`);
    if (cached) tiles.set(demTileKey(address), cached);
    else missing.push(address);
  }
  // Absent tiles are not cached: they are rare, and caching a null would need
  // a second map to distinguish "known absent" from "not yet fetched".
  for (const [key, png] of await tileBytes(source, missing, areas)) {
    const tile = await decodeTile(png);
    cacheTile(`${source.id}/${key}`, tile);
    tiles.set(key, tile);
  }
  return tiles;
}

/**
 * Read the DEM at each position, in order, from the public sources and the
 * areas the caller may read. Null where no source has it.
 */
export function sampleElevations(
  positions: readonly SamplePosition[],
  areas: readonly VisibleSharpenedArea[] = [],
): Promise<DemSamples> {
  return sampleDem(
    positions,
    (source, wanted) => readTiles(source, wanted, areas),
    demSourcesFor(areas),
  );
}

/** The slope at a position and where it came from; null where none can tell. */
export function sampleSlope(
  lon: number,
  lat: number,
  areas: readonly VisibleSharpenedArea[] = [],
): Promise<DemSlopeReading | null> {
  return demSlopeReading(
    lon,
    lat,
    (source, wanted) => readTiles(source, wanted, areas),
    demSourcesFor(areas),
  );
}

/** Test seam — the cache is process-wide and would otherwise leak between tests. */
export function clearDemTileCache() {
  tileCache.clear();
  archives.clear();
  clearDemArchives();
}

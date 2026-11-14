// The place registries, held in memory for location search as you type
// (ADR 0034): one index for each region that declares `placeSearch`. The files
// are public on the topo CDN; the API reads them there like the DEM
// (services/elevation.ts), so local dev reads MiniStack's copy.
//
// Loaded in the background after boot and re-read every few minutes: until a
// region's build has loaded, `placeIndex(region)` is null and its search
// answers 503. A new build replaces the old one only once it has parsed and
// indexed, so a failed refresh keeps the index already held.
//
// PRIVACY: nothing here sees a query. The URLs are our own public files.
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import {
  indexPlaceRegistry,
  isPlaceRegistryPointer,
  placeRegistryPointerPath,
  placeRegistryUrl,
  REGIONS,
  type PlaceIndex,
  type PlaceRegistryFile,
  type Region,
} from "@logjam/shared";
import { getEnv } from "../lib/env";
import { logger, safeErrorForLog } from "../lib/logger";

/** The builder publishes monthly and the pointer is cached for five minutes. */
const REFRESH_MS = 5 * 60_000;
// Until a build has loaded, search answers 503: a CDN blip at boot would
// otherwise cost five minutes of it after every deploy.
const FIRST_LOAD_RETRY_MS = 30_000;
const POINTER_TIMEOUT_MS = 8_000;
// About 5 MB from our own CDN; generous, because a stalled transfer only delays the
// next version, never a request.
const FILE_TIMEOUT_MS = 60_000;

/** A region with a registry: `placeSearch` is its CDN prefix. */
type Registered = Pick<Region, "id"> & { placeSearch: string };

/** The regions whose registry this process holds. */
function registered(regions: readonly Region[]): Registered[] {
  return regions.filter(
    (r): r is Region & Registered => r.placeSearch !== null,
  );
}

/** By region id. */
const held = new Map<
  string,
  { index: PlaceIndex; version: string; path: string }
>();

/** A region's registry, or null while none has loaded. */
export function placeIndex(
  regionId: string,
): { index: PlaceIndex; version: string } | null {
  return held.get(regionId) ?? null;
}

/**
 * The file, parsed. It is published with `Content-Encoding: gzip`, which
 * fetch decodes; bytes that still start with gzip's magic number came from a
 * server that did not say so, and are gunzipped here.
 *
 * Its own function so the download and the text are unreachable before
 * indexing starts: on a 1 GiB instance the parse is the peak, and the index
 * keeps none of it but the names.
 */
async function readRegistryFile(
  response: Response,
): Promise<PlaceRegistryFile> {
  const bytes = Buffer.from(await response.arrayBuffer());
  const json =
    bytes[0] === 0x1f && bytes[1] === 0x8b
      ? await promisify(gunzip)(bytes)
      : bytes;
  return JSON.parse(json.toString("utf8")) as PlaceRegistryFile;
}

/**
 * Read each region's pointer, and load the build it names if it is not the
 * one held, one region at a time so at most one parsed file is alive beside
 * the indexes in use.
 *
 * MEMORY: each region's registry stays resident. Measured on a made-up file
 * with NSW's row count (321,000 rows, 16 MB of JSON; node 24, 2026-11-14):
 * loading it took the process's resident size 164 to 171 MB above where it
 * began at the peak, and 110 to 125 MB above it once the parse was
 * collected (32 MB of live heap and 14 MB of typed arrays). Each region declaring a registry
 * adds about that much; a country needs an on-disk index or a larger instance
 * (docs/operations/brain.md, "When it outgrows the box").
 */
export async function refreshPlaceRegistry(
  regions: readonly Region[] = REGIONS,
): Promise<void> {
  const base = getEnv().TOPO_CDN_BASE_URL?.replace(/\/$/, "");
  if (!base) return;
  for (const region of registered(regions)) await refreshRegion(base, region);
}

async function refreshRegion(base: string, region: Registered): Promise<void> {
  const loaded = held.get(region.id);
  try {
    const pointerResponse = await fetch(
      `${base}/${placeRegistryPointerPath(region.placeSearch)}`,
      { signal: AbortSignal.timeout(POINTER_TIMEOUT_MS) },
    );
    // Not published yet: look again at the next refresh.
    if (pointerResponse.status === 404 || pointerResponse.status === 403) {
      await pointerResponse.body?.cancel();
      if (!loaded)
        logger.info({ region: region.id }, "place_registry_not_published");
      return;
    }
    if (!pointerResponse.ok) {
      await pointerResponse.body?.cancel();
      throw new Error(`pointer request failed with ${pointerResponse.status}`);
    }
    const pointer: unknown = await pointerResponse.json();
    if (!isPlaceRegistryPointer(pointer)) {
      throw new Error("pointer is not a place registry pointer");
    }
    // The path, not the version: a rebuild of the same extract keeps its
    // version and gets a new content hash in its name.
    if (loaded?.path === pointer.path) return;

    const fileResponse = await fetch(
      placeRegistryUrl(base, region.placeSearch, pointer),
      { signal: AbortSignal.timeout(FILE_TIMEOUT_MS) },
    );
    if (!fileResponse.ok) {
      await fileResponse.body?.cancel();
      throw new Error(`file request failed with ${fileResponse.status}`);
    }
    const index = indexPlaceRegistry(await readRegistryFile(fileResponse));
    held.set(region.id, {
      index,
      version: pointer.version,
      path: pointer.path,
    });
    logger.info(
      { region: region.id, version: pointer.version, rows: index.names.length },
      "place_registry_loaded",
    );
  } catch (err) {
    logger.warn(
      {
        region: region.id,
        err: safeErrorForLog(err),
        loaded: loaded?.version ?? null,
      },
      "place_registry_refresh_failed",
    );
  }
}

/**
 * Load now, in the background, then again every REFRESH_MS (every
 * FIRST_LOAD_RETRY_MS until every region has loaded). The next refresh is
 * scheduled only when the last has finished, so two loads never overlap and
 * at most one parsed file is alive beside the indexes in use. Returns a stop.
 */
export function startPlaceRegistry(
  regions: readonly Region[] = REGIONS,
): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const run = () =>
    void refreshPlaceRegistry(regions).then(() => {
      if (stopped) return;
      const allLoaded = registered(regions).every((r) => held.has(r.id));
      timer = setTimeout(run, allLoaded ? REFRESH_MS : FIRST_LOAD_RETRY_MS);
      timer.unref();
    });
  run();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** Test seam: the indexes are process-wide. */
export function clearPlaceRegistry(): void {
  held.clear();
}

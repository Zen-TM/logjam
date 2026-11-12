// The place registry, held in memory for location search as you type
// (ADR 0034). The file is public on the topo CDN; the API reads it there like
// the DEM (services/elevation.ts), so local dev reads MiniStack's copy.
//
// Loaded in the background after boot and re-read every few minutes: until a
// build has loaded, `placeIndex()` is null and the search answers 503. A new
// build replaces the old one only once it has parsed and indexed, so a failed
// refresh keeps the index already held.
//
// PRIVACY: nothing here sees a query. The URLs are our own public files.
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import {
  indexPlaceRegistry,
  isPlaceRegistryPointer,
  PLACE_REGISTRY_POINTER_PATH,
  placeRegistryUrl,
  type PlaceIndex,
  type PlaceRegistryFile,
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

let held: { index: PlaceIndex; version: string; path: string } | null = null;

/** The registry searches read, or null while none has loaded. */
export function placeIndex(): { index: PlaceIndex; version: string } | null {
  return held;
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

/** Read the pointer, and load the build it names if it is not the one held. */
export async function refreshPlaceRegistry(): Promise<void> {
  const base = getEnv().TOPO_CDN_BASE_URL?.replace(/\/$/, "");
  if (!base) return;
  try {
    const pointerResponse = await fetch(
      `${base}/${PLACE_REGISTRY_POINTER_PATH}`,
      { signal: AbortSignal.timeout(POINTER_TIMEOUT_MS) },
    );
    // Not published yet: look again at the next refresh.
    if (pointerResponse.status === 404 || pointerResponse.status === 403) {
      await pointerResponse.body?.cancel();
      if (!held) logger.info("place_registry_not_published");
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
    if (held?.path === pointer.path) return;

    const fileResponse = await fetch(placeRegistryUrl(base, pointer), {
      signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
    });
    if (!fileResponse.ok) {
      await fileResponse.body?.cancel();
      throw new Error(`file request failed with ${fileResponse.status}`);
    }
    const index = indexPlaceRegistry(await readRegistryFile(fileResponse));
    held = { index, version: pointer.version, path: pointer.path };
    logger.info(
      { version: pointer.version, rows: index.names.length },
      "place_registry_loaded",
    );
  } catch (err) {
    logger.warn(
      { err: safeErrorForLog(err), loaded: held?.version ?? null },
      "place_registry_refresh_failed",
    );
  }
}

/**
 * Load now, in the background, then again every REFRESH_MS (every
 * FIRST_LOAD_RETRY_MS until one has loaded). The next refresh is scheduled
 * only when the last has finished, so two loads never overlap and at most
 * one parsed file is alive beside the index in use. Returns a stop.
 */
export function startPlaceRegistry(): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const run = () =>
    void refreshPlaceRegistry().then(() => {
      if (stopped) return;
      timer = setTimeout(run, held ? REFRESH_MS : FIRST_LOAD_RETRY_MS);
      timer.unref();
    });
  run();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** Test seam: the index is process-wide. */
export function clearPlaceRegistry(): void {
  held = null;
}

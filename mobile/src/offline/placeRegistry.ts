// The place registries on this phone: every named OpenStreetMap feature in a
// region, one copy for each region the user chose or saved a map of, searched
// as the user types with nothing typed leaving the phone (ADR 0034).
//
// WHEN A COPY IS FETCHED: first with the user's first region download (for a
// guest too: the file is a public CDN object, not a call to our API), for each
// region that download touches and each region the user chose. After that
// every copy is kept fresh at app start, on return to the foreground and on
// regained signal, as `topoAutoDownload.ts` is, Wi-Fi only by default, and
// never in offline-only mode or on a timer (ADR 0013). A region that declares
// no registry has no copy.
//
// A BAD DOWNLOAD NEVER REPLACES A GOOD FILE: the new file lands at a temporary
// path, is parsed and its version checked, and only then takes the old one's
// place. The pointer is written once the file is in place, so a phone killed
// mid-swap reads the previous build. Guards: placeRegistry.test.ts ("a bad
// download never replaces a good file", and "a failed swap leaves the old
// build for the next session").
//
// WHERE A COPY LIVES: the registry NSW had when it was the only one stays where
// it was, in PLACE_REGISTRY_DIR itself; every other region's is in a folder
// named for it. Guard: placeRegistry.test.ts ("keeps each region's copy apart").
//
// THE FILE IS SAVED AS PLAIN JSON: the CDN serves it with Content-Encoding:
// gzip, so the platform's HTTP stack decompresses it (ADR 0034). gunzipping it
// in JavaScript held a Pixel's JS thread for 1.4 s, so fflate is only the
// fallback for a stack that saved the gzip as it came.
//
// MEMORY: an index is tens of MB, so a region's is built only when the search
// box first opens over it, a slice at a time so the map keeps answering, and
// kept for the session. // ponytail: every index built stays; with many large
// regions on one phone, drop the one not in view.
//
// PRIVACY: the requests carry no headers and no query, only a public file's
// path, and every phone fetches the same file for a region. Which regions a
// phone fetches is the CDN's to see, as it sees which tiles a phone saves.
// Guard: placeRegistry.test.ts ("from the CDN with nothing else sent").
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { File } from "expo-file-system";
import { gunzipSync, strFromU8 } from "fflate";
import {
  indexPlaceRegistryInSlices,
  isPlaceRegistryPointer,
  placeRegistryPointerPath,
  placeRegistryUrl,
  PLACE_REGISTRY_PREFIX,
  regionsOf,
  regionsTouching,
  REGIONS,
  type LonLatBox,
  type PlaceIndex,
  type PlaceRegistryFile,
  type PlaceRegistryPointer,
  type Region,
} from "@logjam/shared";

import { downloadFromPresignedUrl } from "../api/presignedTransfer";
import { config } from "../config";
import { subscribeReconnect } from "../map/connectivity";
import { readPref, writePref } from "../prefsDb";
import { readRegions } from "../regionsPreference";
import { assertSpaceFor, hasSpaceFor, NotEnoughSpaceError } from "./freeSpace";
import { PLACE_REGISTRY_DIR } from "./localStores";
import { canRunNow } from "./networkPolicy";
import { isOfflineOnly } from "./offlineOnlyMode";
import { listArtifacts } from "./registryDb";

/** A region that declares a registry: `placeSearch` is its CDN prefix. */
type Registered = Region & { placeSearch: string };

/** The region with this id, if it declares a registry. */
function registered(regionId: string | null): Registered | null {
  const region = REGIONS.find((r) => r.id === regionId);
  return region?.placeSearch ? (region as Registered) : null;
}

/** The folder a region's copy is saved in: see WHERE A COPY LIVES above. */
function dirOf(region: Registered): string {
  return region.placeSearch === PLACE_REGISTRY_PREFIX
    ? PLACE_REGISTRY_DIR
    : `${PLACE_REGISTRY_DIR}${region.id}/`;
}
const pointerUri = (region: Registered) => `${dirOf(region)}pointer.json`;
const downloadUri = (region: Registered) => `${dirOf(region)}download.tmp`;

/** "on" once the user started a region download. Unset (null) on a phone that
 *  has not. The files cannot be removed from the phone, so nothing writes "off"
 *  any more; a phone still holding "off" from when they could be removed is
 *  treated as unset and gets the public file again, which holds nothing about
 *  the user (ADR 0034). One answer for every region. */
const WANTED_PREF_KEY = "placeRegistryWanted";

/** The path of a build whose index would not build, for one region. Not
 *  fetched again; keyed by the content-hashed path, not the version, which is
 *  the extract's date and stays the same for a fixed rebuild of the same
 *  extract. */
const unreadableKey = (region: Registered) =>
  `placeRegistryUnreadable:${region.id}`;

/** A build's download, for its price before this phone has seen a pointer,
 *  and the refresh's monthly cost: the 2026-10-15 NSW build is 4.4 MB
 *  gzipped. */
export const PLACE_REGISTRY_DOWNLOAD_ESTIMATE = "About 4 MB";

/** Bytes on disk per byte downloaded: the file is saved decompressed. The
 *  2026-10-15 build is 14,657,625 bytes of JSON from 4,433,458 gzipped. */
const DISK_PER_DOWNLOADED_BYTE = 3.31;

/** The pointer is a few bytes; a CDN that sits on it is down. */
const POINTER_TIMEOUT_MS = 15_000;

/** Minimum gap between automatic checks, as in `topoAutoDownload.ts`. */
const MIN_INTERVAL_MS = 10_000;

export type PlaceRegistryStatus = {
  /** The build on this phone, or null when it has none. */
  stored: PlaceRegistryPointer | null;
  /** The last load of the stored build failed and kept the file: the search
   *  box offers Try again. Cleared by the next load or install. */
  loadFailed: boolean;
};

/** One region's copy: what is on the phone, in memory, and in flight. */
type Copy = {
  status: PlaceRegistryStatus;
  index: PlaceIndex | null;
  /** The load in flight, and the build it is for. */
  loading: {
    build: PlaceRegistryPointer;
    promise: Promise<PlaceIndex | null>;
  } | null;
  /** The fetch in flight, and whether it may use mobile data. */
  fetching: { promise: Promise<FetchOutcome>; allowMetered: boolean } | null;
};

const NO_COPY: PlaceRegistryStatus = { stored: null, loadFailed: false };
const copies = new Map<string, Copy>();
const listeners = new Set<() => void>();
let lastCheckAt = 0;

function copyOf(region: Registered): Copy {
  let copy = copies.get(region.id);
  if (!copy) {
    copy = {
      status: { stored: readStoredPointer(region), loadFailed: false },
      index: null,
      loading: null,
      fetching: null,
    };
    copies.set(region.id, copy);
  }
  return copy;
}

function publish(region: Registered, next: Partial<PlaceRegistryStatus>): void {
  const copy = copyOf(region);
  copy.status = { ...copy.status, ...next };
  for (const listener of listeners) listener();
}

/** A region's copy as the box reads it; none for a region with no registry. */
export function placeRegistryStatus(
  regionId: string | null,
): PlaceRegistryStatus {
  const region = registered(regionId);
  return region ? copyOf(region).status : NO_COPY;
}

export function usePlaceRegistryStatus(
  regionId: string | null,
): PlaceRegistryStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => placeRegistryStatus(regionId),
  );
}

function readStoredPointer(region: Registered): PlaceRegistryPointer | null {
  try {
    const file = new File(pointerUri(region));
    if (!file.exists) return null;
    const pointer: unknown = JSON.parse(file.textSync());
    return isPlaceRegistryPointer(pointer) ? pointer : null;
  } catch {
    // An unreadable pointer is no file: the next check downloads it again.
    return null;
  }
}

function dataUri(region: Registered, pointer: PlaceRegistryPointer): string {
  return `${dirOf(region)}${pointer.path}`;
}

/** A region's index, if it is loaded. Synchronous, for a search on every
 *  keystroke. */
export function placeIndex(regionId: string | null): PlaceIndex | null {
  const region = registered(regionId);
  return region ? copyOf(region).index : null;
}

/** Whether this phone holds a build for the region, loaded or not. */
export function hasPlaceRegistry(regionId: string | null): boolean {
  return placeRegistryStatus(regionId).stored !== null;
}

/**
 * Load a region's stored file into memory, once per build; subscribers hear
 * when it is ready. Null when there is none, it cannot be read, or another
 * build replaced it meanwhile; a later call tries again.
 */
export function loadPlaceIndex(
  regionId: string | null,
): Promise<PlaceIndex | null> {
  const region = registered(regionId);
  if (!region) return Promise.resolve(null);
  const copy = copyOf(region);
  if (copy.index) return Promise.resolve(copy.index);
  const stored = copy.status.stored;
  if (!stored) return Promise.resolve(null);
  if (copy.loading?.build === stored) return copy.loading.promise;
  const promise: Promise<PlaceIndex | null> = buildIndex(
    region,
    stored,
  ).finally(() => {
    if (copy.loading?.promise === promise) copy.loading = null;
  });
  copy.loading = { build: stored, promise };
  if (copy.status.loadFailed) publish(region, { loadFailed: false });
  return promise;
}

/** The file is not the build its pointer names. */
class MismatchError extends Error {}

async function buildIndex(
  region: Registered,
  stored: PlaceRegistryPointer,
): Promise<PlaceIndex | null> {
  const copy = copyOf(region);
  try {
    const file = await readFile(dataUri(region, stored), stored);
    const built = await indexPlaceRegistryInSlices(
      file,
      yieldToEventLoop,
    ).catch((err: unknown) => {
      // Fetched again, it would be downloaded and fail at every search.
      writePref(unreadableKey(region), stored.path);
      throw new MismatchError(String(err));
    });
    if (copy.status.stored !== stored) return null;
    copy.index = built;
    publish(region, {});
    return built;
  } catch (err) {
    console.error(err);
    // Forgotten, so the next check downloads it again; only when the file is
    // wrong and the pointer on disk still names it. A read that failed for
    // another reason keeps it for the next open.
    if (copy.status.stored !== stored) return null;
    if (
      err instanceof MismatchError &&
      readStoredPointer(region)?.path === stored.path
    ) {
      await FileSystem.deleteAsync(pointerUri(region), {
        idempotent: true,
      }).catch(() => {});
      await FileSystem.deleteAsync(dataUri(region, stored), {
        idempotent: true,
      }).catch(() => {});
      publish(region, { stored: null });
    } else {
      // Kept, so nothing else changes: say so, or the box loads forever.
      publish(region, { loadFailed: true });
    }
    return null;
  }
}
/** A timer, not a microtask: the map's touches and frames run between
 *  slices. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The base64 of a gzip file's first two bytes, 1f 8b. */
const GZIP_MAGIC_BASE64 = "H4s=";

/** Parse one data file, refusing one the pointer did not describe. Throws on
 *  anything that would not search. */
async function readFile(
  uri: string,
  pointer: PlaceRegistryPointer,
): Promise<PlaceRegistryFile> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new MismatchError("Place registry file is missing");
  const head = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length: 2,
  });
  let text: string;
  if (head === GZIP_MAGIC_BASE64) {
    // Checked before gunzipping: fflate sizes its output from the file's last
    // four bytes, so a cut-off file had it allocate gigabytes on the Pixel.
    // The pointer's `bytes` is the gzipped size, so only this path can check.
    if (info.size !== pointer.bytes) {
      throw new MismatchError("Place registry file is not its pointer's size");
    }
    const bytes = await new File(uri).bytes();
    try {
      text = strFromU8(gunzipSync(bytes));
    } catch {
      throw new MismatchError("Place registry file is not gzip");
    }
  } else {
    text = await new File(uri).text();
  }
  let file: PlaceRegistryFile;
  try {
    file = JSON.parse(text) as PlaceRegistryFile;
  } catch {
    throw new MismatchError("Place registry file is not JSON");
  }
  if (file.version !== pointer.version || !Array.isArray(file.names)) {
    throw new MismatchError("Place registry file does not match its pointer");
  }
  return file;
}

export type FetchOutcome =
  | "current"
  | "updated"
  /** No connection, mobile data not allowed, or no space for a refresh. */
  | "skipped"
  | "offline-only"
  /** The CDN's build is one this phone could not index before. */
  | "unreadable"
  | "failed";

/**
 * Bring this phone's copy of a region's registry up to the CDN's current
 * build.
 *
 * `allowMetered` is the user's answer for a fetch they started (a region
 * download's "use mobile data"); a refresh leaves it
 * out and asks the `placeNames` connection policy instead. A fetch the user
 * started rejects with NotEnoughSpaceError when the file would not fit; a
 * refresh skips. A region with no registry fetches nothing and is "failed".
 */
export async function fetchPlaceRegistry(
  regionId: string,
  options: { allowMetered?: boolean },
): Promise<FetchOutcome> {
  const region = registered(regionId);
  if (!region) return "failed";
  const copy = copyOf(region);
  const running = copy.fetching;
  if (running) {
    let outcome: FetchOutcome;
    try {
      outcome = await running.promise;
    } catch (err) {
      // A run the user started, refused for space: a refresh only skips.
      if (
        options.allowMetered === undefined &&
        err instanceof NotEnoughSpaceError
      )
        return "skipped";
      throw err;
    }
    // The run in flight may have waited for Wi-Fi when this caller need not.
    if (outcome !== "skipped" || running.allowMetered || !options.allowMetered)
      return outcome;
    return fetchPlaceRegistry(regionId, options);
  }
  const promise = runFetch(region, options.allowMetered).finally(() => {
    copy.fetching = null;
  });
  copy.fetching = { promise, allowMetered: options.allowMetered === true };
  return promise;
}

async function runFetch(
  region: Registered,
  allowMetered?: boolean,
): Promise<FetchOutcome> {
  if (isOfflineOnly()) return "offline-only";
  if (!(await canRunNow("placeNames", allowMetered))) return "skipped";
  try {
    const pointer = await fetchPointer(region);
    if (!pointer) return "failed";
    if (pointer.version === copyOf(region).status.stored?.version)
      return "current";
    if (pointer.path === readPref(unreadableKey(region))) return "unreadable";
    // ADR 0005: nothing large is written without asking whether it fits.
    const onDisk = Math.ceil(pointer.bytes * DISK_PER_DOWNLOADED_BYTE);
    if (allowMetered === undefined) {
      if (!(await hasSpaceFor(onDisk))) return "skipped";
    } else {
      await assertSpaceFor(onDisk);
    }
    await installBuild(region, pointer);
    return "updated";
  } catch (err) {
    if (err instanceof NotEnoughSpaceError) throw err;
    console.error(err);
    return "failed";
  } finally {
    await FileSystem.deleteAsync(downloadUri(region), {
      idempotent: true,
    }).catch(() => {});
  }
}

async function fetchPointer(
  region: Registered,
): Promise<PlaceRegistryPointer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POINTER_TIMEOUT_MS);
  try {
    // No headers: the platform default and nothing else.
    const response = await fetch(
      `${config.topoCdnBaseUrl}/${placeRegistryPointerPath(region.placeSearch)}`,
      { signal: controller.signal },
    );
    if (!response.ok) return null;
    const pointer: unknown = await response.json();
    return isPlaceRegistryPointer(pointer) ? pointer : null;
  } finally {
    clearTimeout(timer);
  }
}

async function installBuild(
  region: Registered,
  pointer: PlaceRegistryPointer,
): Promise<void> {
  const dir = dirOf(region);
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  // Not presigned, but the same first-byte timeout suits a public file.
  const result = await downloadFromPresignedUrl(
    placeRegistryUrl(config.topoCdnBaseUrl, region.placeSearch, pointer),
    downloadUri(region),
  );
  if (result.status !== 200) {
    throw new Error(`Place registry download answered ${result.status}`);
  }
  // Parsed before it replaces anything, off the first frames. Not indexed:
  // the index is built only for a search. The timeout keeps a busy JS thread
  // (map animation, track recording) from deferring the update forever.
  await new Promise<void>((resolve) =>
    requestIdleCallback(() => resolve(), { timeout: 2000 }),
  );
  await readFile(downloadUri(region), pointer);

  const target = dataUri(region, pointer);
  await FileSystem.deleteAsync(target, { idempotent: true });
  await FileSystem.moveAsync({ from: downloadUri(region), to: target });
  await FileSystem.writeAsStringAsync(
    pointerUri(region),
    JSON.stringify(pointer),
  );
  // Published before the old file goes, so a load of the old build that fails
  // now sees it was replaced and forgets nothing. The next search builds the
  // new one.
  copyOf(region).index = null;
  publish(region, { stored: pointer, loadFailed: false });
  // Only the new build is kept: the old file, and anything a crash left.
  // Best effort: the install is done, and the next one sweeps again. NSW's
  // folder also holds the other regions' folders, which are not its to sweep.
  try {
    for (const name of await FileSystem.readDirectoryAsync(dir)) {
      if (
        name !== pointer.path &&
        name !== "pointer.json" &&
        !REGIONS.some((r) => r.id === name)
      ) {
        await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true });
      }
    }
  } catch (err) {
    console.error(err);
  }
}

/** The regions that have a registry among `regions`, as ids. */
const withRegistry = (regions: readonly Region[]): Registered[] =>
  regions.filter((r): r is Registered => r.placeSearch !== null);

/**
 * A region download started. The first one brings the registries, on the
 * connection the user allowed for the maps: one for each region the saved box
 * touches and each region the user chose. A phone that already has a copy
 * fetches nothing for that region.
 */
export function placeRegistryWithRegion(
  allowMetered: boolean,
  box: LonLatBox,
): void {
  if (readPref(WANTED_PREF_KEY) !== "on") writePref(WANTED_PREF_KEY, "on");
  for (const region of withRegistry([
    ...regionsTouching(box, REGIONS),
    ...regionsOf(readRegions(), REGIONS),
  ])) {
    if (hasPlaceRegistry(region.id)) continue;
    // Silent, the space refusal too: the maps' own download says if they fit.
    fetchPlaceRegistry(region.id, { allowMetered }).catch((err: unknown) =>
      console.error(err),
    );
  }
}

/** The automatic check for one region: only for a phone that wants the file. */
export function refreshPlaceRegistry(regionId: string): Promise<FetchOutcome> {
  if (readPref(WANTED_PREF_KEY) !== "on") return Promise.resolve("skipped");
  return fetchPlaceRegistry(regionId, {});
}

/**
 * The regions whose copy this phone keeps current: the ones the user chose,
 * the ones a saved map touches, and the ones it already holds.
 */
async function regionsToKeep(): Promise<Registered[]> {
  const saved = (await listArtifacts()).flatMap((artifact) =>
    artifact.kind === "basemap-region" && artifact.bbox
      ? regionsTouching(
          {
            west: artifact.bbox[0],
            south: artifact.bbox[1],
            east: artifact.bbox[2],
            north: artifact.bbox[3],
          },
          REGIONS,
        )
      : [],
  );
  const wanted = new Set([
    ...regionsOf(readRegions(), REGIONS),
    ...saved,
    ...REGIONS.filter((r) => hasPlaceRegistry(r.id)),
  ]);
  return withRegistry(REGIONS.filter((r) => wanted.has(r)));
}

async function refreshAll(): Promise<void> {
  for (const region of await regionsToKeep()) {
    await refreshPlaceRegistry(region.id);
  }
}

function requestCheck(): void {
  if (Date.now() - lastCheckAt < MIN_INTERVAL_MS) return;
  lastCheckAt = Date.now();
  refreshAll().catch((err: unknown) => console.error(err));
}

/**
 * A phone that held a region before Logjam GPS had the registry counts as
 * having asked: its user downloaded for the field before the file existed.
 */
async function adoptForSavedRegions(): Promise<void> {
  if (readPref(WANTED_PREF_KEY) === "on") return;
  const artifacts = await listArtifacts();
  if (artifacts.some((artifact) => artifact.kind === "basemap-region")) {
    writePref(WANTED_PREF_KEY, "on");
  }
}

/** Wire the refresh to the three moments. Returns the cleanup. */
export function registerPlaceRegistryRefresh(): () => void {
  const appStateSub = AppState.addEventListener("change", (state) => {
    if (state === "active") requestCheck();
  });
  const netInfoUnsub = subscribeReconnect(requestCheck);
  void adoptForSavedRegions()
    .catch((err: unknown) => console.error(err))
    .then(requestCheck);
  return () => {
    appStateSub.remove();
    netInfoUnsub();
  };
}

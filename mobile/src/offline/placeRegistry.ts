// The place registry on this phone: every named OpenStreetMap feature in NSW,
// searched as the user types with nothing typed leaving the phone (ADR 0034).
//
// WHEN IT IS FETCHED: first with the user's first region download (for a
// guest too: the file is a public CDN object, not a call to our API), or from
// Settings → Map. After that it is kept fresh at app start, on return to the
// foreground and on regained signal, as `topoAutoDownload.ts` is, Wi-Fi only
// by default, and never in offline-only mode or on a timer (ADR 0013).
//
// A BAD DOWNLOAD NEVER REPLACES A GOOD FILE: the new file lands at a temporary
// path, is parsed and its version checked, and only then takes the old one's
// place. The pointer is written last, so a phone killed mid-swap reads the
// previous build. Guard: placeRegistry.test.ts.
//
// THE FILE IS SAVED AS PLAIN JSON: the CDN serves it with Content-Encoding:
// gzip, so the platform's HTTP stack decompresses it (ADR 0034). gunzipping it
// in JavaScript held a Pixel's JS thread for 1.4 s, so fflate is only the
// fallback for a stack that saved the gzip as it came.
//
// MEMORY: the index is tens of MB, so it is built only when the search box
// first opens, a slice at a time so the map keeps answering, and kept for the
// session.
//
// PRIVACY: the requests carry no headers and no query, only the public file's
// path, and every phone fetches the same file.
import { useSyncExternalStore } from "react";
import { AppState, InteractionManager } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { File } from "expo-file-system";
import { gunzipSync, strFromU8 } from "fflate";
import {
  indexPlaceRegistryInSlices,
  isPlaceRegistryPointer,
  placeRegistryUrl,
  PLACE_REGISTRY_POINTER_PATH,
  type PlaceIndex,
  type PlaceRegistryFile,
  type PlaceRegistryPointer,
} from "@logjam/shared";

import { downloadFromPresignedUrl } from "../api/presignedTransfer";
import { config } from "../config";
import { subscribeReconnect } from "../map/connectivity";
import { readPref, writePref } from "../prefsDb";
import { PLACE_REGISTRY_DIR } from "./localStores";
import { canRunNow } from "./networkPolicy";
import { isOfflineOnly } from "./offlineOnlyMode";
import { listArtifacts } from "./registryDb";

const POINTER_URI = `${PLACE_REGISTRY_DIR}pointer.json`;
const DOWNLOAD_URI = `${PLACE_REGISTRY_DIR}download.tmp`;

/** "on" once the user started a region download or asked in Settings; "off"
 *  once they removed it, which a later region download does not undo. Unset
 *  (null) on a phone that has done neither. */
const WANTED_PREF_KEY = "placeRegistryWanted";

/** The pointer is a few bytes; a CDN that sits on it is down. */
const POINTER_TIMEOUT_MS = 15_000;

/** Minimum gap between automatic checks, as in `topoAutoDownload.ts`. */
const MIN_INTERVAL_MS = 10_000;

export type PlaceRegistryStatus = {
  /** The build on this phone, or null when it has none. */
  stored: PlaceRegistryPointer | null;
  /** What the stored build takes on disk: the pointer's `bytes` is the
   *  download, gzipped. */
  storedBytes: number;
  /** The newest build this session has seen, stored or not, for the size of
   *  a download not yet made. */
  latest: PlaceRegistryPointer | null;
  downloading: boolean;
};

const initial = readStoredPointer();
let status: PlaceRegistryStatus = {
  stored: initial,
  storedBytes: initial ? diskBytes(initial) : 0,
  latest: initial,
  downloading: false,
};
const listeners = new Set<() => void>();
let index: PlaceIndex | null = null;
let loading: Promise<PlaceIndex | null> | null = null;
let fetching: Promise<FetchOutcome> | null = null;
let lastCheckAt = 0;

function publish(next: Partial<PlaceRegistryStatus>): void {
  status = { ...status, ...next };
  for (const listener of listeners) listener();
}

export function usePlaceRegistryStatus(): PlaceRegistryStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => status,
  );
}

function readStoredPointer(): PlaceRegistryPointer | null {
  try {
    const file = new File(POINTER_URI);
    if (!file.exists) return null;
    const pointer: unknown = JSON.parse(file.textSync());
    return isPlaceRegistryPointer(pointer) ? pointer : null;
  } catch {
    // An unreadable pointer is no file: the next check downloads it again.
    return null;
  }
}

function dataUri(pointer: PlaceRegistryPointer): string {
  return `${PLACE_REGISTRY_DIR}${pointer.path}`;
}

function diskBytes(pointer: PlaceRegistryPointer): number {
  try {
    return new File(dataUri(pointer)).size;
  } catch {
    return 0;
  }
}

/** The index, if it is loaded. Synchronous, for a search on every keystroke. */
export function placeIndex(): PlaceIndex | null {
  return index;
}

/** Whether this phone holds a build, loaded or not. */
export function hasPlaceRegistry(): boolean {
  return status.stored !== null;
}

/**
 * Load the stored file into memory, once. Null when there is none or it
 * cannot be read; a later call tries again.
 */
export function loadPlaceIndex(): Promise<PlaceIndex | null> {
  if (index) return Promise.resolve(index);
  const stored = status.stored;
  if (!stored) return Promise.resolve(null);
  loading ??= readFile(dataUri(stored), stored)
    .then((file) => indexPlaceRegistryInSlices(file, yieldToEventLoop))
    .then((loaded) => {
      // A build swapped in meanwhile is loaded on the next open instead.
      if (status.stored === stored) index = loaded;
      return loaded;
    })
    .catch(async (err: unknown) => {
      console.error(err);
      if (status.stored !== stored) return null;
      // Forgotten, so the next check downloads it again.
      await FileSystem.deleteAsync(POINTER_URI, { idempotent: true }).catch(
        () => {},
      );
      publish({ stored: null, storedBytes: 0 });
      return null;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
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
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists || info.size !== pointer.bytes) {
      throw new Error("Place registry file is not the size of its pointer");
    }
    text = strFromU8(gunzipSync(await new File(uri).bytes()));
  } else {
    text = await new File(uri).text();
  }
  const file = JSON.parse(text) as PlaceRegistryFile;
  if (file.version !== pointer.version || !Array.isArray(file.names)) {
    throw new Error("Place registry file does not match its pointer");
  }
  return file;
}

export type FetchOutcome = "current" | "updated" | "skipped" | "failed";

/**
 * Bring this phone's file up to the CDN's current build.
 *
 * `allowMetered` is the user's answer for a fetch they started (a region
 * download's "use mobile data", or a press in Settings); a refresh asks the
 * `placeNames` connection policy instead.
 */
export function fetchPlaceRegistry(options: {
  allowMetered?: boolean;
}): Promise<FetchOutcome> {
  fetching ??= runFetch(options.allowMetered).finally(() => {
    fetching = null;
    publish({ downloading: false });
  });
  return fetching;
}

async function runFetch(allowMetered?: boolean): Promise<FetchOutcome> {
  if (isOfflineOnly()) return "skipped";
  if (!(await canRunNow("placeNames", allowMetered))) return "skipped";
  try {
    const pointer = await fetchPointer();
    if (!pointer) return "failed";
    publish({ latest: pointer });
    if (pointer.version === status.stored?.version) return "current";
    publish({ downloading: true });
    await installBuild(pointer);
    return "updated";
  } catch (err) {
    console.error(err);
    return "failed";
  } finally {
    await FileSystem.deleteAsync(DOWNLOAD_URI, { idempotent: true }).catch(
      () => {},
    );
  }
}

async function fetchPointer(): Promise<PlaceRegistryPointer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POINTER_TIMEOUT_MS);
  try {
    // No headers: the platform default and nothing else.
    const response = await fetch(
      `${config.topoCdnBaseUrl}/${PLACE_REGISTRY_POINTER_PATH}`,
      { signal: controller.signal },
    );
    if (!response.ok) return null;
    const pointer: unknown = await response.json();
    return isPlaceRegistryPointer(pointer) ? pointer : null;
  } finally {
    clearTimeout(timer);
  }
}

async function installBuild(pointer: PlaceRegistryPointer): Promise<void> {
  await FileSystem.makeDirectoryAsync(PLACE_REGISTRY_DIR, {
    intermediates: true,
  });
  // Not presigned, but the same first-byte timeout suits a public file.
  const result = await downloadFromPresignedUrl(
    placeRegistryUrl(config.topoCdnBaseUrl, pointer),
    DOWNLOAD_URI,
  );
  if (result.status !== 200) {
    throw new Error(`Place registry download answered ${result.status}`);
  }
  // Parsed before it replaces anything, off the first frames. Not indexed:
  // the index is built only for a search.
  await new Promise<void>((resolve) =>
    InteractionManager.runAfterInteractions(() => resolve()),
  );
  await readFile(DOWNLOAD_URI, pointer);

  const target = dataUri(pointer);
  await FileSystem.deleteAsync(target, { idempotent: true });
  await FileSystem.moveAsync({ from: DOWNLOAD_URI, to: target });
  await FileSystem.writeAsStringAsync(POINTER_URI, JSON.stringify(pointer));
  // Only the new build is kept: the old file, and anything a crash left.
  for (const name of await FileSystem.readDirectoryAsync(PLACE_REGISTRY_DIR)) {
    if (name !== pointer.path && name !== "pointer.json") {
      await FileSystem.deleteAsync(`${PLACE_REGISTRY_DIR}${name}`, {
        idempotent: true,
      });
    }
  }
  // The next search builds the new one.
  index = null;
  publish({ stored: pointer, storedBytes: diskBytes(pointer) });
}

/** Delete the file and stop refreshing it, until the user asks again. */
export async function removePlaceRegistry(): Promise<void> {
  writePref(WANTED_PREF_KEY, "off");
  await fetching;
  await FileSystem.deleteAsync(PLACE_REGISTRY_DIR, { idempotent: true });
  index = null;
  publish({ stored: null, storedBytes: 0 });
}

/** Settings → Map's Download: wanted from now on, on any connection. */
export function requestPlaceRegistry(): Promise<FetchOutcome> {
  writePref(WANTED_PREF_KEY, "on");
  return fetchPlaceRegistry({ allowMetered: true });
}

/**
 * A region download started. The first one brings the file, on the connection
 * the user allowed for the maps; a phone that already has it, or whose user
 * removed it, fetches nothing.
 */
export function placeRegistryWithRegion(allowMetered: boolean): void {
  const wanted = readPref(WANTED_PREF_KEY);
  if (wanted === "off") return;
  if (wanted !== "on") writePref(WANTED_PREF_KEY, "on");
  if (hasPlaceRegistry()) return;
  void fetchPlaceRegistry({ allowMetered });
}

/** The automatic check: only for a phone that wants the file. */
export function refreshPlaceRegistry(): Promise<FetchOutcome> {
  if (readPref(WANTED_PREF_KEY) !== "on") return Promise.resolve("skipped");
  return fetchPlaceRegistry({});
}

function requestCheck(): void {
  if (Date.now() - lastCheckAt < MIN_INTERVAL_MS) return;
  lastCheckAt = Date.now();
  void refreshPlaceRegistry();
}

/**
 * A phone that held a region before Logjam GPS had the registry counts as
 * having asked: its user downloaded for the field before the file existed.
 * Never once they removed it.
 */
async function adoptForSavedRegions(): Promise<void> {
  if (readPref(WANTED_PREF_KEY) !== null) return;
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

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
// path, is gunzipped, parsed and indexed, and only then takes the old one's
// place. The pointer is written last, so a phone killed mid-swap reads the
// previous build. Guard: placeRegistry.test.ts.
//
// MEMORY: the parsed and indexed file is about 90 MB of JS heap, so it is
// loaded only when the search box first opens, and kept for the session.
//
// PRIVACY: the requests carry no headers and no query, only the public file's
// path, and every phone fetches the same file.
import { useSyncExternalStore } from "react";
import { AppState, InteractionManager } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { File } from "expo-file-system";
import { gunzipSync, strFromU8 } from "fflate";
import {
  indexPlaceRegistry,
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

const POINTER_URI = `${PLACE_REGISTRY_DIR}pointer.json`;
const DOWNLOAD_URI = `${PLACE_REGISTRY_DIR}download.tmp`;

/** "on" once the user started a region download or asked in Settings; "off"
 *  once they removed it, which a later region download does not undo. */
const WANTED_PREF_KEY = "placeRegistryWanted";

/** The pointer is a few bytes; a CDN that sits on it is down. */
const POINTER_TIMEOUT_MS = 15_000;

/** Minimum gap between automatic checks, as in `topoAutoDownload.ts`. */
const MIN_INTERVAL_MS = 10_000;

export type PlaceRegistryStatus = {
  /** The build on this phone, or null when it has none. */
  stored: PlaceRegistryPointer | null;
  downloading: boolean;
};

let status: PlaceRegistryStatus = {
  stored: readStoredPointer(),
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
  loading ??= readIndex(`${PLACE_REGISTRY_DIR}${stored.path}`, stored)
    .then((loaded) => {
      // A download that finished meanwhile set a newer index; keep that one.
      index ??= loaded;
      return index;
    })
    .catch(async (err: unknown) => {
      console.error(err);
      // Forgotten, so the next check downloads it again.
      await FileSystem.deleteAsync(POINTER_URI, { idempotent: true }).catch(
        () => {},
      );
      publish({ stored: null });
      return null;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Gunzip, parse and index one data file, refusing one the pointer did not
 *  describe. Throws on anything that would not search. Only the index
 *  outlives it: the text and the parsed file are garbage once it returns. */
async function readIndex(
  uri: string,
  pointer: PlaceRegistryPointer,
): Promise<PlaceIndex> {
  const bytes = await new File(uri).bytes();
  const file = JSON.parse(strFromU8(gunzipSync(bytes))) as PlaceRegistryFile;
  if (file.version !== pointer.version || !Array.isArray(file.names)) {
    throw new Error("Place registry file does not match its pointer");
  }
  return indexPlaceRegistry(file);
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
  // Parsed and indexed before it replaces anything, off the first frames.
  await new Promise<void>((resolve) =>
    InteractionManager.runAfterInteractions(() => resolve()),
  );
  const fresh = await readIndex(DOWNLOAD_URI, pointer);

  const dataUri = `${PLACE_REGISTRY_DIR}${pointer.path}`;
  await FileSystem.deleteAsync(dataUri, { idempotent: true });
  await FileSystem.moveAsync({ from: DOWNLOAD_URI, to: dataUri });
  await FileSystem.writeAsStringAsync(POINTER_URI, JSON.stringify(pointer));
  // Only the new build is kept: the old file, and anything a crash left.
  for (const name of await FileSystem.readDirectoryAsync(PLACE_REGISTRY_DIR)) {
    if (name !== pointer.path && name !== "pointer.json") {
      await FileSystem.deleteAsync(`${PLACE_REGISTRY_DIR}${name}`, {
        idempotent: true,
      });
    }
  }
  // Held only by a session that already loaded one: a refresh at app start
  // must not leave 90 MB in memory for someone who never searches.
  if (index) index = fresh;
  publish({ stored: pointer });
}

/** Delete the file and stop refreshing it, until the user asks again. */
export async function removePlaceRegistry(): Promise<void> {
  writePref(WANTED_PREF_KEY, "off");
  await fetching;
  await FileSystem.deleteAsync(PLACE_REGISTRY_DIR, { idempotent: true });
  index = null;
  publish({ stored: null });
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

/** Wire the refresh to the three moments. Returns the cleanup. */
export function registerPlaceRegistryRefresh(): () => void {
  const appStateSub = AppState.addEventListener("change", (state) => {
    if (state === "active") requestCheck();
  });
  const netInfoUnsub = subscribeReconnect(requestCheck);
  requestCheck();
  return () => {
    appStateSub.remove();
    netInfoUnsub();
  };
}

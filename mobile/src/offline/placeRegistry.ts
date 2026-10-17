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
// place. The pointer is written once the file is in place, so a phone killed
// mid-swap reads the previous build. Guards: placeRegistry.test.ts ("a bad
// download never replaces a good file", and "a failed swap leaves the old
// build for the next session").
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
// path, and every phone fetches the same file. Guard: placeRegistry.test.ts
// ("from the CDN with nothing else sent").
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
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
import { unavailableReasonText } from "../auth/capabilities";
import { config } from "../config";
import { subscribeReconnect } from "../map/connectivity";
import { readPref, writePref } from "../prefsDb";
import type { ToastMessage } from "../ui";
import { assertSpaceFor, hasSpaceFor, NotEnoughSpaceError } from "./freeSpace";
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

/** The path of a build whose index would not build. Not fetched again; keyed
 *  by the content-hashed path, not the version, which is the extract's date
 *  and stays the same for a fixed rebuild of the same extract. */
const UNREADABLE_PREF_KEY = "placeRegistryUnreadable";

/** A build's download, for its price before this phone has seen a pointer,
 *  and the refresh's monthly cost: the 2026-10-15 build is 4.4 MB gzipped. */
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
  /** What the stored build takes on disk: the pointer's `bytes` is the
   *  download, gzipped. */
  storedBytes: number;
  /** The newest build this session has seen, stored or not, for the size of
   *  a download not yet made. */
  latest: PlaceRegistryPointer | null;
  downloading: boolean;
  /** The last load of the stored build failed and kept the file: the search
   *  box offers Try again. Cleared by the next load, install or Remove. */
  loadFailed: boolean;
};

const initial = readStoredPointer();
let status: PlaceRegistryStatus = {
  stored: initial,
  storedBytes: initial ? diskBytes(initial) : 0,
  latest: initial,
  downloading: false,
  loadFailed: false,
};
const listeners = new Set<() => void>();
let index: PlaceIndex | null = null;
/** The load in flight, and the build it is for. */
let loading: {
  build: PlaceRegistryPointer;
  promise: Promise<PlaceIndex | null>;
} | null = null;
/** The fetch in flight, and whether it may use mobile data. */
let fetching: { promise: Promise<FetchOutcome>; allowMetered: boolean } | null =
  null;
let lastCheckAt = 0;

function publish(next: Partial<PlaceRegistryStatus>): void {
  status = { ...status, ...next };
  for (const listener of listeners) listener();
}

export function placeRegistryStatus(): PlaceRegistryStatus {
  return status;
}

export function usePlaceRegistryStatus(): PlaceRegistryStatus {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, placeRegistryStatus);
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
 * Load the stored file into memory, once per build; subscribers hear when it
 * is ready. Null when there is none, it cannot be read, or another build
 * replaced it meanwhile; a later call tries again.
 */
export function loadPlaceIndex(): Promise<PlaceIndex | null> {
  if (index) return Promise.resolve(index);
  const stored = status.stored;
  if (!stored) return Promise.resolve(null);
  if (loading?.build === stored) return loading.promise;
  const promise: Promise<PlaceIndex | null> = buildIndex(stored).finally(() => {
    if (loading?.promise === promise) loading = null;
  });
  loading = { build: stored, promise };
  if (status.loadFailed) publish({ loadFailed: false });
  return promise;
}

/** The file is not the build its pointer names. */
class MismatchError extends Error {}

async function buildIndex(
  stored: PlaceRegistryPointer,
): Promise<PlaceIndex | null> {
  try {
    const file = await readFile(dataUri(stored), stored);
    const built = await indexPlaceRegistryInSlices(
      file,
      yieldToEventLoop,
    ).catch((err: unknown) => {
      // Fetched again, it would be downloaded and fail at every search.
      writePref(UNREADABLE_PREF_KEY, stored.path);
      throw new MismatchError(String(err));
    });
    if (status.stored !== stored) return null;
    index = built;
    publish({});
    return built;
  } catch (err) {
    console.error(err);
    // Forgotten, so the next check downloads it again; only when the file is
    // wrong and the pointer on disk still names it. A read that failed for
    // another reason keeps it for the next open.
    if (status.stored !== stored) return null;
    if (
      err instanceof MismatchError &&
      readStoredPointer()?.path === stored.path
    ) {
      await FileSystem.deleteAsync(POINTER_URI, { idempotent: true }).catch(
        () => {},
      );
      await FileSystem.deleteAsync(dataUri(stored), { idempotent: true }).catch(
        () => {},
      );
      publish({ stored: null, storedBytes: 0 });
    } else {
      // Kept, so nothing else changes: say so, or the box loads forever.
      publish({ loadFailed: true });
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
 * Bring this phone's file up to the CDN's current build.
 *
 * `allowMetered` is the user's answer for a fetch they started (a region
 * download's "use mobile data", or a press in Settings); a refresh leaves it
 * out and asks the `placeNames` connection policy instead. A fetch the user
 * started rejects with NotEnoughSpaceError when the file would not fit; a
 * refresh skips.
 */
export async function fetchPlaceRegistry(options: {
  allowMetered?: boolean;
}): Promise<FetchOutcome> {
  const running = fetching;
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
    return fetchPlaceRegistry(options);
  }
  const promise = runFetch(options.allowMetered).finally(() => {
    fetching = null;
    publish({ downloading: false });
  });
  fetching = { promise, allowMetered: options.allowMetered === true };
  return promise;
}

async function runFetch(allowMetered?: boolean): Promise<FetchOutcome> {
  if (isOfflineOnly()) return "offline-only";
  if (!(await canRunNow("placeNames", allowMetered))) return "skipped";
  try {
    const pointer = await fetchPointer();
    if (!pointer) return "failed";
    publish({ latest: pointer });
    if (pointer.version === status.stored?.version) return "current";
    if (pointer.path === readPref(UNREADABLE_PREF_KEY)) return "unreadable";
    // ADR 0005: nothing large is written without asking whether it fits.
    const onDisk = Math.ceil(pointer.bytes * DISK_PER_DOWNLOADED_BYTE);
    if (allowMetered === undefined) {
      if (!(await hasSpaceFor(onDisk))) return "skipped";
    } else {
      await assertSpaceFor(onDisk);
    }
    publish({ downloading: true });
    await installBuild(pointer);
    return "updated";
  } catch (err) {
    if (err instanceof NotEnoughSpaceError) throw err;
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
  await new Promise<void>((resolve) => requestIdleCallback(() => resolve()));
  await readFile(DOWNLOAD_URI, pointer);

  const target = dataUri(pointer);
  await FileSystem.deleteAsync(target, { idempotent: true });
  await FileSystem.moveAsync({ from: DOWNLOAD_URI, to: target });
  await FileSystem.writeAsStringAsync(POINTER_URI, JSON.stringify(pointer));
  // Published before the old file goes, so a load of the old build that fails
  // now sees it was replaced and forgets nothing. The next search builds the
  // new one.
  index = null;
  publish({
    stored: pointer,
    storedBytes: diskBytes(pointer),
    loadFailed: false,
  });
  // Only the new build is kept: the old file, and anything a crash left.
  // Best effort: the install is done, and the next one sweeps again.
  try {
    for (const name of await FileSystem.readDirectoryAsync(
      PLACE_REGISTRY_DIR,
    )) {
      if (name !== pointer.path && name !== "pointer.json") {
        await FileSystem.deleteAsync(`${PLACE_REGISTRY_DIR}${name}`, {
          idempotent: true,
        });
      }
    }
  } catch (err) {
    console.error(err);
  }
}

// --- Toasts -----------------------------------------------------------------
// Settings → Map's Download and Remove finish wherever the user has got to, so
// they announce themselves at the app shell (BackgroundToast.tsx), as a region
// download does. Region-started and automatic fetches stay silent.
const toastListeners = new Set<
  (message: Omit<ToastMessage, "nonce">) => void
>();

/** Subscribe to Download's and Remove's outcomes: BackgroundToast only. */
export function onPlaceRegistryToast(
  listener: (message: Omit<ToastMessage, "nonce">) => void,
): () => void {
  toastListeners.add(listener);
  return () => toastListeners.delete(listener);
}

function toast(text: string): void {
  for (const listener of toastListeners) listener({ text, tone: "error" });
}

/** What Download says when it did not bring the file; nothing when it did. */
export const DOWNLOAD_PROBLEM: Record<FetchOutcome, string | null> = {
  updated: null,
  current: null,
  skipped: unavailableReasonText("needs-connection"),
  "offline-only": "Turn off Offline maps only to download place names.",
  unreadable:
    "The latest place names can't be read, so Logjam GPS waits for the next build.",
  failed: "Download didn't finish.",
};

/** Delete the file and stop refreshing it, until the user asks again. */
export async function removePlaceRegistry(): Promise<void> {
  writePref(WANTED_PREF_KEY, "off");
  await fetching?.promise.catch(() => {});
  try {
    await FileSystem.deleteAsync(PLACE_REGISTRY_DIR, { idempotent: true });
  } catch (err) {
    console.error(err);
    toast("Couldn't remove the place names.");
    return;
  }
  index = null;
  publish({ stored: null, storedBytes: 0, loadFailed: false });
}

/** Settings → Map's Download: wanted from now on, on any connection. */
export async function requestPlaceRegistry(): Promise<FetchOutcome> {
  writePref(WANTED_PREF_KEY, "on");
  try {
    const outcome = await fetchPlaceRegistry({ allowMetered: true });
    const problem = DOWNLOAD_PROBLEM[outcome];
    if (problem) toast(problem);
    return outcome;
  } catch (err) {
    toast(
      err instanceof NotEnoughSpaceError
        ? err.message
        : (DOWNLOAD_PROBLEM.failed ?? ""),
    );
    return "failed";
  }
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
  // Silent, the space refusal too: the maps' own download says if they fit.
  fetchPlaceRegistry({ allowMetered }).catch((err: unknown) =>
    console.error(err),
  );
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

// The sharpened areas the account could last see, kept without their URLs:
// what the offline sampler, the climb upgrade and the offline map read when
// the list can't be fetched. Each new list replaces it, so an area deleted or
// unshared drops out the next time the list loads.
//
// PRIVACY: an area's coverage and tile range say where its owner surveyed.
// The file is wiped with the account (SHARPENED_AREAS_DIR), a list asked for
// before that wipe is never written (`sharpenedAreasEpoch`), and nothing here
// logs. Guard: sharpenedAreaStore.test.ts.
import * as FileSystem from "expo-file-system/legacy";
import type { SharpenedArea, SharpenedOverlay } from "@logjam/shared";

import { sharpenedAreasEpoch } from "../map/sharpenedArchives";
import { SHARPENED_AREAS_DIR } from "./localStores";

const FILE = `${SHARPENED_AREAS_DIR}areas.json`;

const isArea = (a: SharpenedArea): boolean =>
  typeof a?.id === "string" &&
  (a.zmax === 16 || a.zmax === 17) &&
  Array.isArray(a.tiles15) &&
  a.tiles15.length === 4 &&
  Array.isArray(a.coverage) &&
  a.coverage.length === 4 &&
  typeof a.contours === "boolean" &&
  typeof a.credit === "string" &&
  typeof a.createdAt === "string";

// Null until the file has been read in this JS context.
let areas: readonly SharpenedArea[] | null = null;
// Writes run one at a time, each checking the epoch it was asked in.
let tail: Promise<void> = Promise.resolve();
// The mounted map, told when the kept list changes: the save screen keeps
// the list it cut from, which can be newer than the one the map loaded.
const listeners = new Set<() => void>();

/** Called whenever the kept list changes; returns the unsubscribe. */
export function subscribeSharpenedAreas(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The areas last kept, read once from the file. Sends nothing. */
export async function savedSharpenedAreas(): Promise<readonly SharpenedArea[]> {
  if (areas) return areas;
  let read: SharpenedArea[] = [];
  try {
    const parsed: unknown = JSON.parse(
      await FileSystem.readAsStringAsync(FILE),
    );
    if (Array.isArray(parsed)) read = parsed.filter(isArea);
  } catch {
    // No file yet, or not one this build wrote: no areas.
  }
  // A list remembered while the file was being read is the newer one.
  areas ??= read;
  return areas;
}

/**
 * Keep `list` (its URLs dropped) in place of the last one, unless it was
 * asked for before a sign-out wipe (`areasEpoch`, from `inAreasEpoch`).
 */
export function rememberSharpenedAreas(
  list: readonly SharpenedOverlay[],
  areasEpoch: number,
): Promise<void> {
  if (areasEpoch !== sharpenedAreasEpoch()) return tail;
  const kept = list.map(
    ({ heightsUrl: _h, slopeUrl: _s, contoursUrl: _c, ...area }) => area,
  );
  areas = kept;
  for (const listener of listeners) listener();
  tail = tail
    .then(async () => {
      if (areasEpoch !== sharpenedAreasEpoch()) return;
      await FileSystem.makeDirectoryAsync(SHARPENED_AREAS_DIR, {
        intermediates: true,
      });
      await FileSystem.writeAsStringAsync(FILE, JSON.stringify(kept));
    })
    // The list is kept in memory either way; the file catches up next time.
    .catch(() => {});
  return tail;
}

/**
 * Called by the sign-out wipe after `stopSharpenedAreasForWipe`: the areas
 * in memory go, and a write already running finishes before the files do.
 */
export function forgetSharpenedAreas(): Promise<void> {
  areas = [];
  for (const listener of listeners) listener();
  return tail;
}

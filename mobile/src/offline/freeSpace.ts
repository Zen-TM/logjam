// "Will this fit?", asked once, by everything that writes a large file.
//
// Writers (the vector clip, topo overlay bundle, GeoPDF rendered pyramid, and
// unattended auto-downloaders) check space upfront so writes do not fail
// mid-batch when storage is exhausted.
//
// There is no eviction anywhere in Logjam GPS: nothing reclaims an artifact by
// age or pressure, so "not enough space" is a decision the user has to make.
// This module only makes sure they are asked before the bytes start, not after.
//
// PRIVACY: byte counts about this handset. Nothing here names a file.
import * as FileSystem from "expo-file-system/legacy";

/**
 * Headroom the write must leave. A phone at literally zero free bytes cannot
 * finish a SQLite transaction (WAL, journal, the container's own overhead), and
 * the estimates feeding this are means, not ceilings.
 */
const HEADROOM = 0.9;

/** Pure half, so the rule is testable without a filesystem. Guard: `src/offline/freeSpace.test.ts`. */
export function fitsInFreeSpace(
  neededBytes: number,
  freeBytes: number,
): boolean {
  return neededBytes <= freeBytes * HEADROOM;
}

/** Static, user-facing; the caller may show it as-is. */
export function notEnoughSpaceMessage(
  neededBytes: number,
  freeBytes: number,
): string {
  const mb = (bytes: number) =>
    `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
  return `Needs about ${mb(neededBytes)}; the phone has ${mb(freeBytes)} free. Free some space and try again.`;
}

export class NotEnoughSpaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotEnoughSpaceError";
  }
}

/**
 * Throw unless `neededBytes` fits, with the headroom above.
 *
 * A free-space read that FAILS is not treated as a refusal: the write is the
 * user's own request and the filesystem will report its own failure soon
 * enough. An unknown answer must not become a phantom "not enough space".
 */
export async function assertSpaceFor(neededBytes: number): Promise<void> {
  const freeBytes = await FileSystem.getFreeDiskStorageAsync().catch(
    () => null,
  );
  if (freeBytes == null) return;
  if (!fitsInFreeSpace(neededBytes, freeBytes)) {
    throw new NotEnoughSpaceError(
      notEnoughSpaceMessage(neededBytes, freeBytes),
    );
  }
}

/** The unattended callers' form: no throw, just "should I start". */
export async function hasSpaceFor(neededBytes: number): Promise<boolean> {
  const freeBytes = await FileSystem.getFreeDiskStorageAsync().catch(
    () => null,
  );
  return freeBytes == null || fitsInFreeSpace(neededBytes, freeBytes);
}

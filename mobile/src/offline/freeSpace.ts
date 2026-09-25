// "Will this fit?", asked once, by everything that writes a large file.
//
// The download screen already asked it — and it was the ONLY writer that did.
// The vector clip (up to 80 MB), the topo overlay bundle, a GeoPDF's rendered
// pyramid and both unattended auto-downloaders all wrote until SQLite failed
// mid-batch, which surfaces as "That didn't finish. Try again." with no hint
// that the phone is full and nothing reclaimed. Worse, the screen's own check
// summed only the RASTER pyramids, so a vector-only selection prechecked zero
// bytes against an up-to-80 MB download.
//
// There is no eviction anywhere in this app: nothing reclaims an artifact by
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

/** Pure half, so the rule is testable without a filesystem. */
export function fitsInFreeSpace(neededBytes: number, freeBytes: number): boolean {
  return neededBytes <= freeBytes * HEADROOM;
}

/** Static, user-facing; the caller may show it as-is. */
export function notEnoughSpaceMessage(neededBytes: number, freeBytes: number): string {
  const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
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
  const freeBytes = await FileSystem.getFreeDiskStorageAsync().catch(() => null);
  if (freeBytes == null) return;
  if (!fitsInFreeSpace(neededBytes, freeBytes)) {
    throw new NotEnoughSpaceError(notEnoughSpaceMessage(neededBytes, freeBytes));
  }
}

/** The unattended callers' form: no throw, just "should I start". */
export async function hasSpaceFor(neededBytes: number): Promise<boolean> {
  const freeBytes = await FileSystem.getFreeDiskStorageAsync().catch(() => null);
  return freeBytes == null || fitsInFreeSpace(neededBytes, freeBytes);
}

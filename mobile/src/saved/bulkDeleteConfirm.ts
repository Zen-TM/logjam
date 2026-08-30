// The confirm body for deleting a SELECTION, kept pure (and out of
// SavedScreen.tsx) so every combination can be read in one place and tested.
//
// A bulk delete is two different deletes wearing one button: most saved assets
// are files on this handset, but a route or a waypoint is a synced record whose
// delete reaches the account and everyone its canyons are shared with
// (assetActions.ts). One sentence covering a mixed selection is false for half
// of it, so each kind gets its own clause — and a selection of only one kind
// never mentions the other, rather than reading as a filled-in template.
import { formatBytes } from "../format";

export function bulkDeleteConfirmBody({
  onDeviceCount,
  syncedCount,
  onDeviceBytes,
}: {
  /** Files on this handset: regions, topos, GeoPDFs, imports, recordings. */
  onDeviceCount: number;
  /** Routes and waypoints — synced records, not files. */
  syncedCount: number;
  /** Disk the on-device half gives back. Zero for kinds with no file size. */
  onDeviceBytes: number;
}): string {
  const freed = onDeviceBytes > 0 ? `, freeing ${formatBytes(onDeviceBytes)}` : "";
  const accountReach =
    "removed from your account and from any friends they're shared with";
  const undone = "This can't be undone.";

  // Single-kind selections talk about the whole thing, so they take a pronoun
  // back to the title ("Delete 3 items?") instead of restating the count.
  if (syncedCount === 0) {
    return `${onDeviceCount === 1 ? "It is" : "They are"} deleted from this phone${freed}. ${undone}`;
  }
  if (onDeviceCount === 0) {
    return `${syncedCount === 1 ? "It is" : "They are"} ${accountReach}. ${undone}`;
  }

  // Mixed: the account-reaching half leads, because it is the consequence that
  // travels beyond this handset.
  const synced =
    syncedCount === 1
      ? `One of them is a route or waypoint, ${accountReach}`
      : `${syncedCount} of them are routes and waypoints, ${accountReach}`;
  const rest =
    onDeviceCount === 1
      ? "The other one is deleted from this phone"
      : `The other ${onDeviceCount} are deleted from this phone`;
  return `${synced}. ${rest}${freed}. ${undone}`;
}

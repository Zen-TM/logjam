// The confirm body for deleting a SELECTION, kept pure (and out of
// SavedScreen.tsx) so every combination can be read in one place and tested.
//
// A bulk delete is two different deletes wearing one button: a region, topo or
// GeoPDF is a file on this handset, but a route, an import or a recording is
// synced, and its delete reaches the account and everyone it is shared with
// (`delete.synced` in assetActions.ts). One sentence covering a mixed selection
// is false for half of it, so each kind gets its own clause — and a selection
// of only one kind never mentions the other, rather than reading as a
// filled-in template.
import { formatBytes } from "../format";
import { plural, t } from "@logjam/shared";

/** The split, read from each item's own delete descriptor and never its kind. */
export function bulkDeleteCounts(items: { delete?: { synced: boolean } }[]): {
  onDeviceCount: number;
  syncedCount: number;
} {
  const deletable = items.filter((item) => item.delete);
  const syncedCount = deletable.filter((item) => item.delete!.synced).length;
  return { onDeviceCount: deletable.length - syncedCount, syncedCount };
}

export function bulkDeleteConfirmBody({
  onDeviceCount,
  syncedCount,
  onDeviceBytes,
}: {
  /** Files on this handset alone: regions, topos, GeoPDFs. */
  onDeviceCount: number;
  /** Routes, imports and recordings: they also live in the account. */
  syncedCount: number;
  /** Disk the on-device half gives back. Zero for kinds with no file size. */
  onDeviceBytes: number;
}): string {
  // Single-kind selections talk about the whole thing, so they take a pronoun
  // back to the title ("Delete 3 items?") instead of restating the count.
  if (syncedCount === 0) {
    if (onDeviceBytes > 0) {
      const freed = formatBytes(onDeviceBytes);
      return onDeviceCount === 1
        ? t`It is deleted from this phone, freeing ${freed}. This can't be undone.`
        : t`They are deleted from this phone, freeing ${freed}. This can't be undone.`;
    }
    return onDeviceCount === 1
      ? t`It is deleted from this phone. This can't be undone.`
      : t`They are deleted from this phone. This can't be undone.`;
  }
  if (onDeviceCount === 0) {
    return syncedCount === 1
      ? t`It is removed from your account and from any friends they're shared with. This can't be undone.`
      : t`They are removed from your account and from any friends they're shared with. This can't be undone.`;
  }

  // Mixed: the account-reaching half leads, because it is the consequence that
  // travels beyond this handset.
  const synced = plural(
    syncedCount,
    "One of them is a synced file or route, removed from your account and from any friends they're shared with.",
    "# of them are synced files and routes, removed from your account and from any friends they're shared with.",
  );
  const rest =
    onDeviceBytes > 0
      ? plural(
          onDeviceCount,
          "The other one is deleted from this phone, freeing {0}.",
          "The other # are deleted from this phone, freeing {0}.",
          formatBytes(onDeviceBytes),
        )
      : plural(
          onDeviceCount,
          "The other one is deleted from this phone.",
          "The other # are deleted from this phone.",
        );
  return `${synced} ${rest} ${t`This can't be undone.`}`;
}

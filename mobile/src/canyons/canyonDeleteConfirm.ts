// The one description of what deleting a canyon costs.
//
// Two surfaces offer the verb — the Canyons list's per-item overflow sheet and
// the canyon detail screen — and they carried two byte-identical copies of this
// copy. DESIGN.md §7 names that exact failure: "Two places offering 'Delete'
// with two descriptions of what is deleted is how one of them goes stale."
// Same shape as `saved/assetActions.ts`'s `delete` descriptor, so both read
// alike at the call site.
//
// PRIVACY: the canyon NAME is user-supplied text and belongs in a confirm the
// user opened for that canyon (§11). Nothing here touches its position.

export type DeleteConfirmCopy = { confirmTitle: string; confirmBody: string };

/**
 * @param linkedTripCount trips that link to this canyon and will survive it.
 */
export function canyonDeleteConfirm(
  canyonName: string,
  linkedTripCount: number,
): DeleteConfirmCopy {
  return {
    confirmTitle: `Delete ${canyonName}?`,
    confirmBody: [
      "The canyon, its notes and its photos are removed from this device and from your account.",
      linkedTripCount > 0
        ? `${linkedTripCount} logged ${linkedTripCount === 1 ? "trip" : "trips"} will stay, but lose the link to it.`
        : null,
      "This can't be undone.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

// The one description of what deleting a place costs.
//
// Two surfaces offer the verb — the Places list's per-item overflow sheet and
// the place detail screen — and they carried two byte-identical copies of this
// copy. DESIGN.md §7 names that exact failure: "Two places offering 'Delete'
// with two descriptions of what is deleted is how one of them goes stale."
// Same shape as `saved/assetActions.ts`'s `delete` descriptor, so both read
// alike at the call site.
//
// PRIVACY: the place NAME is user-supplied text and belongs in a confirm the
// user opened for that place (§11). Nothing here touches its position.

export type DeleteConfirmCopy = { confirmTitle: string; confirmBody: string };

/**
 * @param linkedTripCount trips that link to this place and will survive it.
 */
export function placeDeleteConfirm(
  placeName: string,
  linkedTripCount: number,
): DeleteConfirmCopy {
  return {
    confirmTitle: `Delete ${placeName}?`,
    confirmBody: [
      "This removes the place, its notes and photos from this device and your account.",
      linkedTripCount > 0
        ? `${linkedTripCount} logged ${linkedTripCount === 1 ? "trip" : "trips"} will stay, but lose the link to it.`
        : null,
      "This can't be undone.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

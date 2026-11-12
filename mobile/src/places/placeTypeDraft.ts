// When the place type form starts over. Apart from the form so it can be
// tested: the form is a hook that is never unmounted between opens, so "which
// draft is this" is a decision, not a side effect of mounting.

/**
 * The identity of what the form holds: a change in it re-seeds the draft.
 *
 * Being CLOSED is an identity of its own. Without it, the draft of a type just
 * added or abandoned with Cancel would persist into the next "New type" open.
 * Guard: `placeTypeDraft.test.ts`.
 */
export function placeTypeFormKey(
  open: boolean,
  editing: { id: string } | null,
): string {
  if (!open) return "closed";
  return editing ? `edit:${editing.id}` : "new";
}

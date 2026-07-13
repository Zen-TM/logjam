import { useCallback, useState } from "react";

/**
 * Wraps a dialog's real close handler so every close trigger — the title-bar
 * X, the Cancel button, Esc, a backdrop click — can share one "discard
 * unsaved changes?" confirm instead of each dialog re-inventing it
 * (CANYON-3 / TRIP-3 / IMPORT-8).
 *
 * Callers wire every close trigger to `requestClose` instead of calling
 * `onClose` directly, and render a confirm (e.g. the shared `ConfirmDialog`)
 * bound to `guardOpen` / `confirmDiscard` / `cancelDiscard`:
 *
 * ```tsx
 * const guard = useUnsavedChangesGuard(isDirty, handleRequestClose);
 * <Dialog onClose={guard.requestClose} ...>
 *   <IconButton onClick={guard.requestClose} ... />
 *   <Button onClick={guard.requestClose}>Cancel</Button>
 * </Dialog>
 * <ConfirmDialog
 *   open={guard.guardOpen}
 *   title="Discard unsaved changes?"
 *   message="Your changes will be lost."
 *   confirmLabel="Discard"
 *   confirmColor="error"
 *   onConfirm={guard.confirmDiscard}
 *   onClose={guard.cancelDiscard}
 * />
 * ```
 *
 * `isDirty` must reflect real edits (compare current form values against the
 * values the form was populated with) — never just "the dialog is open". A
 * save that completes should call `onClose` (the raw handler) directly,
 * bypassing the guard entirely, so a successful save never prompts.
 */
export function useUnsavedChangesGuard(isDirty: boolean, onClose: () => void) {
  const [guardOpen, setGuardOpen] = useState(false);

  const requestClose = useCallback(() => {
    if (isDirty) {
      setGuardOpen(true);
      return;
    }
    onClose();
  }, [isDirty, onClose]);

  const confirmDiscard = useCallback(() => {
    setGuardOpen(false);
    onClose();
  }, [onClose]);

  const cancelDiscard = useCallback(() => {
    setGuardOpen(false);
  }, []);

  return { requestClose, guardOpen, confirmDiscard, cancelDiscard };
}

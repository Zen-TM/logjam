import type { ConfirmCopy } from "@logjam/shared";

type Pending = {
  copy: ConfirmCopy;
  cancelLabel: string;
  resolve: (confirmed: boolean) => void;
};

// What `ConfirmHost` (mounted once, in the shell) is asked to draw: first in,
// first shown. Kept apart from the component so the queue runs in a plain test.
const queue: Pending[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/**
 * The one way Logjam GPS asks "are you sure" (mobile/DESIGN.md §4): a themed
 * dialog with Cancel and the verb, never a second wording of Cancel. Resolves
 * true on the verb and false on Cancel, the backdrop or the back gesture.
 *
 * `cancelLabel` is the one exception, for the second step of a two-step verb
 * where "Cancel" would read as backing out of the whole thing: removing a
 * member who has files asks "Keep files" / "Delete files" after the first
 * confirm has already said yes. Only `plans/PeopleView.tsx` may pass it
 * (`confirm.test.ts`, "cancelLabel is passed only by the second step").
 */
export function confirm(
  copy: ConfirmCopy,
  options?: { cancelLabel?: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    queue.push({
      copy,
      cancelLabel: options?.cancelLabel ?? "Cancel",
      resolve,
    });
    emit();
  });
}

/** The confirm on screen, or undefined. Stable between answers. */
export const pendingConfirm = (): Pending | undefined => queue[0];

export function answerConfirm(confirmed: boolean) {
  const answered = queue.shift();
  emit();
  answered?.resolve(confirmed);
}

export function subscribeConfirm(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

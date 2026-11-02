import { TOAST_MS } from "./designTokens.js";

/** A toast is an outcome that worked, or one that did not. */
export type ToastTone = "done" | "error";

/** One thing a toast offers to do ("Undo", "Open", "Log a trip"). */
export type ToastAction = { label: string; onPress: () => void };

/** Pressing a toast's action does it, then dismisses the toast. */
export function runToastAction(action: ToastAction, dismiss: () => void): void {
  action.onPress();
  dismiss();
}

/** A toast that offers an action stays as long as an error: it has to be reachable. */
export function toastMs(tone: ToastTone, action?: ToastAction | null): number {
  return tone === "error" || action ? TOAST_MS.error : TOAST_MS.done;
}

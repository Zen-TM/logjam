import { TOAST_MS } from "./designTokens.js";

/** A toast is an outcome that worked, or one that did not. */
export type ToastTone = "done" | "error";

/** The glyph a toast wears. A check means an outcome that worked, so a toast
 *  that reports none (an instruction, a notice) wears the info glyph instead. */
export function toastGlyph(
  tone: ToastTone,
  informs?: boolean,
): "warning" | "info" | "success" {
  return tone === "error" ? "warning" : informs ? "info" : "success";
}

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

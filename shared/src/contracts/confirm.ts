import type { IconIdea } from "../icons.js";

/**
 * One confirm, drawn by `confirm()` on Logjam GPS and `ConfirmDialog` on
 * Logjam Web (shared/DESIGN.md §1). A confirm's copy lives in a contract only
 * for a verb both clients have; a one-off confirm declares its own.
 */
export type ConfirmCopy = {
  confirmTitle: string;
  confirmBody: string;
  confirmLabel: string;
  tone: "destructive" | "filled";
  icon?: IconIdea;
};

/** Leaving a form with work in it (shared/DESIGN.md §10). */
export function abandonConfirm(thing: string, isNew: boolean): ConfirmCopy {
  return isNew
    ? {
        confirmTitle: `Discard this ${thing}?`,
        confirmBody: "Nothing you've entered is kept.",
        confirmLabel: "Discard",
        tone: "destructive",
      }
    : {
        confirmTitle: "Discard your changes?",
        confirmBody: `The ${thing} stays as it was.`,
        confirmLabel: "Discard",
        tone: "destructive",
      };
}

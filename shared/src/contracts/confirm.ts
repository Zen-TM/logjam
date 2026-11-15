import type { IconIdea } from "../icons.js";
import { t } from "../i18n.js";

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
        confirmTitle: t`Discard this ${thing}?`,
        confirmBody: t`Nothing you've entered is kept.`,
        confirmLabel: t`Discard`,
        tone: "destructive",
        icon: "close",
      }
    : {
        confirmTitle: t`Discard your changes?`,
        confirmBody: t`The ${thing} stays as it was.`,
        confirmLabel: t`Discard`,
        tone: "destructive",
        icon: "close",
      };
}

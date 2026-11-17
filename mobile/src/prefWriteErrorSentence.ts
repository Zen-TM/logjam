import { t } from "@logjam/shared";
import type { PrefWriteError } from "./prefsDb";

/** The sentence for `lastPrefWriteError()`, written where the language is known:
 *  prefsDb.ts loads before it and cannot import `t`. */
export function prefWriteErrorSentence(error: PrefWriteError): string {
  switch (error) {
    case "unavailable":
      return t`This phone's preference store isn't available.`;
    case "not_stored":
      return t`This phone wouldn't store that preference.`;
  }
}

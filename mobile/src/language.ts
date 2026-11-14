// The language this phone runs in, read before `@logjam/shared` loads: contract
// text is evaluated when shared loads, so `language()` must already know it.
// index.ts imports this right after the simulated-regions switch, and neither
// this file nor prefsDb.ts imports anything from shared. Guard: language.test.ts.
import { readPref } from "./prefsDb";

/** The `prefsDb` key for it. */
export const LANGUAGE_PREF_KEY = "language";

const stored = readPref(LANGUAGE_PREF_KEY);
if (stored) {
  (globalThis as { LOGJAM_LANGUAGE?: string }).LOGJAM_LANGUAGE = stored;
}

// The language this browser runs in, read before anything loads `@logjam/shared`:
// contract text is evaluated when shared loads, so `language()` must already
// know it. main.tsx imports this right after the simulated-regions switch, and
// this file imports nothing from shared. Guard: language.test.ts.

/** The one localStorage key for it; kept across sign-out (storageKeys.test.ts). */
export const LANGUAGE_KEY = "logjam.language";

/**
 * The language this browser kept, or null: none kept, or no storage to read (a
 * private window, blocked site data, where the access itself throws). Guards:
 * language.test.ts ("starts in the source language when the browser refuses
 * storage"), languageSetting.test.ts ("does not throw, or reload, when the
 * browser refuses the read").
 */
export function readStoredLanguage(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_KEY);
  } catch {
    return null;
  }
}

const stored = readStoredLanguage();
if (stored) {
  (globalThis as { LOGJAM_LANGUAGE?: string }).LOGJAM_LANGUAGE = stored;
}

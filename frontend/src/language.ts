// The language this browser runs in, read before anything loads `@logjam/shared`:
// contract text is evaluated when shared loads, so `language()` must already
// know it. main.tsx imports this right after the simulated-regions switch, and
// this file imports nothing from shared. Guard: language.test.ts.

/** The one localStorage key for it; kept across sign-out (storageKeys.test.ts). */
export const LANGUAGE_KEY = "logjam.language";

try {
  const stored = localStorage.getItem(LANGUAGE_KEY);
  if (stored) {
    (globalThis as { LOGJAM_LANGUAGE?: string }).LOGJAM_LANGUAGE = stored;
  }
} catch {
  // No storage (a private window, blocked site data): the source language.
}

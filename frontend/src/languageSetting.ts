// Starting in the right language, choosing another, and telling the account
// which one this browser runs in. The language is fixed when Logjam Web starts
// (docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md),
// so a change is stored and the page reloads. Guard: languageSetting.test.ts.
import { useEffect } from "react";
import {
  isLanguage,
  language,
  languageToRecord,
  languageToStart,
  offeredHere,
  type Language,
  type TUser,
} from "@logjam/shared";

import { updateUserPreferences } from "./placeUtils";
import { LANGUAGE_KEY, readStoredLanguage } from "./language";

/** Whether the choice was stored and reads back; a browser that cannot keep it must not reload into a start that finds nothing changed. */
function store(lang: Language): boolean {
  try {
    localStorage.setItem(LANGUAGE_KEY, lang);
  } catch {
    return false;
  }
  return readStoredLanguage() === lang;
}

/**
 * Before the first render: if the language this browser should run in (what it
 * kept, else what it speaks, among what is offered) is not the one it started
 * in, store it and reload once. Returns true when it reloaded, so the caller
 * paints nothing. Also sets `<html lang>`.
 */
export function reconcileLanguage(
  reload: () => void = () => location.reload(),
): boolean {
  document.documentElement.lang = language();
  const next = languageToStart(
    language(),
    readStoredLanguage(),
    navigator.languages ?? [],
    offeredHere(),
  );
  if (next === null || !store(next)) return false;
  reload();
  return true;
}

/** The language row: store the choice and reload. False when it could not be stored. */
export function chooseLanguage(
  next: Language,
  reload: () => void = () => location.reload(),
): boolean {
  if (!isLanguage(next) || !offeredHere().includes(next) || !store(next)) {
    return false;
  }
  reload();
  return true;
}

/**
 * Tell the account which language this browser runs in when it differs from
 * the one recorded, for the messages sent with nobody asking (a push title, a
 * mail). Writes nothing in prod, where the source language is all there is,
 * and nothing before consent settles: `enabled` is the consent gate's `settled`
 * (frontend/AGENTS.md, Data).
 */
export function useRecordLanguage(
  currentUser: TUser | null,
  applyCurrentUser: (user: TUser) => void,
  enabled: boolean,
): void {
  const recorded = currentUser?.uiPreferences?.language;
  const signedIn = currentUser !== null;
  useEffect(() => {
    if (!enabled || !signedIn) return;
    const next = languageToRecord(language(), recorded);
    if (next === null) return;
    updateUserPreferences({ language: next })
      .then(applyCurrentUser)
      .catch(console.error);
  }, [enabled, signedIn, recorded, applyCurrentUser]);
}

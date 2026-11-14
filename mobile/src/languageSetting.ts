// Starting in the right language and choosing another. The language is fixed
// when Logjam GPS starts
// (docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md),
// so a change is stored and the app restarts. Guard: languageSetting.test.ts.
import * as Updates from "expo-updates";
import { I18nManager } from "react-native";
import {
  isLanguage,
  language,
  languageToStart,
  LANGUAGE_SETTING,
  offeredLanguages,
  offersPseudoLanguage,
  type Language,
  type Region,
} from "@logjam/shared";

import { LANGUAGE_PREF_KEY } from "./language";
import { readPref, writePref } from "./prefsDb";

/** What this phone offers: the source alone in prod, so no row. Only a test passes other `regions`. */
export const offeredHere = (regions?: readonly Region[]): Language[] =>
  offeredLanguages(offersPseudoLanguage(), regions);

/** The phone's own language, as a tag (`en_US` is read as `en-US`); none when it will not say. */
export function deviceLanguages(): string[] {
  try {
    const id = I18nManager.getConstants().localeIdentifier;
    return id ? [id] : [];
  } catch {
    return [];
  }
}

/** Reloads the JS bundle; a dev build, with updates off, rejects. */
const restartClient = (): Promise<void> => Updates.reloadAsync();

/**
 * At start, before the first render: if the language this phone should run in
 * (what it kept, else what it speaks, among what is offered) is not the one it
 * started in, store it and restart once. Returns true when it did. A phone that
 * cannot store it does not restart, so it cannot restart on every start.
 */
export function reconcileLanguage(
  device: readonly string[] = deviceLanguages(),
  restart: () => Promise<void> = restartClient,
): boolean {
  const next = languageToStart(
    language(),
    readPref(LANGUAGE_PREF_KEY),
    device,
    offeredHere(),
  );
  if (next === null || !writePref(LANGUAGE_PREF_KEY, next)) return false;
  restart().catch(console.error);
  return true;
}

/**
 * The language row: store the choice and restart. `refused` when it is not
 * offered or the phone would not store it; `stored` when it is kept but the
 * restart failed (a dev build), so it applies at the next launch.
 */
export async function chooseLanguage(
  next: Language,
  restart: () => Promise<void> = restartClient,
): Promise<"restarting" | "stored" | "refused"> {
  if (
    !isLanguage(next) ||
    !offeredHere().includes(next) ||
    !writePref(LANGUAGE_PREF_KEY, next)
  ) {
    return "refused";
  }
  try {
    await restart();
    return "restarting";
  } catch (err) {
    console.error(err);
    return "stored";
  }
}

/**
 * What Settings → Display draws for the language: null with one language
 * offered, else the choices and, while a track records, why they are held (the
 * restart would interrupt it).
 */
export function languageRow(
  offered: readonly Language[],
  tracks: readonly { state: string }[],
): { offered: readonly Language[]; heldReason: string | null } | null {
  if (offered.length < 2) return null;
  return {
    offered,
    heldReason: tracks.some((track) => track.state === "recording")
      ? LANGUAGE_SETTING.held
      : null,
  };
}

// Starting in the right language and choosing another. The language is fixed
// when Logjam GPS starts
// (docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md),
// so a change is stored and the app restarts. Guard: languageSetting.test.ts.
import { useEffect } from "react";
import * as Updates from "expo-updates";
import { I18nManager } from "react-native";
import {
  changesLanguage,
  isLanguage,
  language,
  needsReconsent,
  languageToRecord,
  languageToStart,
  LANGUAGE_SETTING,
  offeredHere,
  showsLanguageChoice,
  type Language,
} from "@logjam/shared";

import type { TUser } from "./api/types";
import { capabilityStatus, type AccountState } from "./auth/capabilities";
import { LANGUAGE_PREF_KEY } from "./language";
import { readPref, writePref } from "./prefsDb";
import { showsRegionStep } from "./screens/regionChoice";
import { findActiveTrack } from "./tracks/tracksDb";

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

/** Whether a track is recording now: a restart would interrupt it. */
const trackRecording = async (): Promise<boolean> =>
  (await findActiveTrack())?.state === "recording";

/**
 * Once the app has mounted: if the language this phone should run in (what it
 * kept, else what it speaks, among what is offered) is not the one it started
 * in, store it and restart once. Returns true when it did. Not while a track
 * records, nor when that cannot be read: the language then applies at the next
 * start. A phone that cannot store it does not restart, so it cannot restart on
 * every start.
 */
export async function reconcileLanguage({
  device = deviceLanguages(),
  restart = restartClient,
  isRecording = trackRecording,
}: {
  device?: readonly string[];
  restart?: () => Promise<void>;
  isRecording?: () => Promise<boolean>;
} = {}): Promise<boolean> {
  const next = languageToStart(
    language(),
    readPref(LANGUAGE_PREF_KEY),
    device,
    offeredHere(),
  );
  if (next === null) return false;
  try {
    if (await isRecording()) return false;
  } catch (err) {
    console.error(err);
    return false;
  }
  if (!writePref(LANGUAGE_PREF_KEY, next)) return false;
  restart().catch(console.error);
  return true;
}

/**
 * The root component's start-up: ask for the restart from the mounted app, never
 * from index.ts's module scope, which Android also evaluates for a headless
 * relaunch of the track recorder (guard: language.test.ts, "index.ts asks for
 * no restart at module scope"). The app therefore mounts once in the old
 * language before the restart lands, so a restart that fails (a dev build)
 * leaves a working app.
 */
export function useStartInLanguage(): void {
  useEffect(() => {
    void reconcileLanguage();
  }, []);
}

/**
 * The language to write to the account, or null. Nothing for a guest, who has
 * no account to write to (ADR 0007: the `serverPrefs` capability decides, as
 * `sendsRegionChoice` does), and nothing until consent has settled and the
 * new-account region step is past: this is the one automatic `PATCH /users/me`
 * that could otherwise fire behind the consent gate and race the region step's
 * own write. Guard: languageSetting.test.ts.
 */
export function languageToSend({
  accountState,
  user,
  consented,
  newAccount,
  running,
}: {
  accountState: AccountState;
  user: TUser | null | undefined;
  /** The consent gate was passed in this session. */
  consented: boolean;
  newAccount: boolean;
  running: Language;
}): Language | null {
  if (!user) return null;
  if (!consented && needsReconsent(user)) return null;
  if (showsRegionStep(newAccount)) return null;
  return capabilityStatus("serverPrefs", accountState, true).status ===
    "available"
    ? languageToRecord(running, user.uiPreferences?.language)
    : null;
}

/**
 * The language row: store the choice and restart. `refused` when it is not
 * offered or the phone would not store it; `stored` when it is kept but the
 * restart failed (a dev build), so it applies at the next launch; `unchanged`
 * for the language already running, which stores and restarts nothing.
 */
export async function chooseLanguage(
  next: Language,
  restart: () => Promise<void> = restartClient,
): Promise<"restarting" | "stored" | "refused" | "unchanged"> {
  if (!changesLanguage(language(), next)) return "unchanged";
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
 * offered, else the choices and, while a track records or until the track list
 * has been read (it may never be), why they are held: the restart would
 * interrupt a recording.
 */
export function languageRow(
  offered: readonly Language[],
  tracks: readonly { state: string }[],
  tracksLoaded: boolean,
): { offered: readonly Language[]; heldReason: string | null } | null {
  if (!showsLanguageChoice(offered)) return null;
  return {
    offered,
    heldReason:
      !tracksLoaded || tracks.some((track) => track.state === "recording")
        ? LANGUAGE_SETTING.held
        : null,
  };
}

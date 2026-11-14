// Which languages Logjam Web and Logjam GPS offer, whether they draw a language
// row, and which language a client starts in. Both clients call these, so the
// decision is made once (languageChoice.test.ts). Reasoning:
// docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md.
import {
  LANGUAGES,
  PSEUDO_LANGUAGE,
  SOURCE_LANGUAGE,
  matchLanguage,
  type Language,
} from "./i18n.js";
import { REGIONS, simRegionsOn, type Region } from "./regions.js";

/**
 * The source language, then each language a region in `regions` declares (one
 * of `LANGUAGES`, in region order), then the pseudo-language when `dev`. With
 * the one region prod has, and `dev` off, that is the source alone, and a
 * client draws no language choice. Guard: languageChoice.test.ts.
 */
export function offeredLanguages(
  dev: boolean,
  regions: readonly Region[] = REGIONS,
): Language[] {
  const offered: Language[] = [SOURCE_LANGUAGE];
  for (const region of regions) {
    for (const tag of region.languages ?? []) {
      const lang = LANGUAGES.find((l) => l.toLowerCase() === tag.toLowerCase());
      if (lang && lang !== PSEUDO_LANGUAGE && !offered.includes(lang)) {
        offered.push(lang);
      }
    }
  }
  if (dev) offered.push(PSEUDO_LANGUAGE);
  return offered;
}

/**
 * What a client offers here: the pseudo-language only where the simulated
 * regions are on, which a build against the prod API refuses
 * (`frontend/src/simRegions.test.ts` "refuses a real-auth build that sets the
 * flag, and leaves the switch off", `mobile/src/simRegions.test.ts` "refuses a
 * build for the prod API that sets the flag, and leaves the switch off"). Only
 * a test passes other `regions`.
 */
export const offeredHere = (regions?: readonly Region[]): Language[] =>
  offeredLanguages(simRegionsOn(), regions);

/** Whether to draw a language row: only with a choice to make, so never in prod. Guard: languageChoice.test.ts. */
export const showsLanguageChoice = (offered: readonly Language[]): boolean =>
  offered.length > 1;

/**
 * The language a client should run in: the stored one if it is still offered,
 * else the first device language that is, else the source. A stored language
 * that is no longer offered (a region unchosen, a dev build's pseudo-language
 * on a release) reads as absent. Guard: languageChoice.test.ts.
 */
export function wantedLanguage(
  stored: string | null,
  device: readonly string[],
  offered: readonly Language[],
): Language {
  return matchLanguage(stored ? [stored, ...device] : device, offered);
}

/**
 * The language to store and restart into, or null when `running` is already
 * the wanted one (so a client restarts at most once). Guard:
 * languageChoice.test.ts.
 */
export function languageToStart(
  running: Language,
  stored: string | null,
  device: readonly string[],
  offered: readonly Language[],
): Language | null {
  const wanted = wantedLanguage(stored, device, offered);
  return wanted === running ? null : wanted;
}

/**
 * Whether choosing `next` in the language row changes anything: choosing the
 * language already running stores nothing and restarts nothing. Guard:
 * languageChoice.test.ts.
 */
export const changesLanguage = (running: Language, next: Language): boolean =>
  running !== next;

/**
 * The language to write to the account (`uiPreferences.language`), or null when
 * it holds `running` already. An account that never recorded one reads as the
 * source, so a client in the source language writes nothing. Guard:
 * languageChoice.test.ts.
 */
export function languageToRecord(
  running: Language,
  recorded: Language | undefined,
): Language | null {
  return running === (recorded ?? SOURCE_LANGUAGE) ? null : running;
}

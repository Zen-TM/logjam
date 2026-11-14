import { AsyncLocalStorage } from "node:async_hooks";
import {
  LANGUAGES,
  PSEUDO_LANGUAGE,
  SOURCE_LANGUAGE,
  matchLanguage,
  normalizeUserUiPreferences,
  setLanguageResolver,
  type Language,
} from "@logjam/shared";
import { nonDevRuntime, type RuntimeEnv } from "./runtime";

// The language of the request in hand, or of the recipient a message is being
// written for. Importing this module is what installs the resolver `say` and
// `t` read, so a file that writes user copy for someone else imports it.
// Guard: requestLanguage.unit.test.ts.
const storage = new AsyncLocalStorage<Language>();
setLanguageResolver(() => storage.getStore());

/** Run `fn`, and everything it awaits, with user copy written in `lang`. */
export function runInLanguage<T>(lang: Language, fn: () => T): T {
  return storage.run(lang, fn);
}

/** Every language but the pseudo-language in a prod runtime, which is for development only. Reads `process.env`, as the other dev-only refusals do, because `getEnv()` drops the AWS variables `nonDevRuntime` reads. */
export function offeredLanguages(
  env: RuntimeEnv = process.env,
): readonly Language[] {
  return nonDevRuntime(env).nonDev
    ? LANGUAGES.filter((lang) => lang !== PSEUDO_LANGUAGE)
    : LANGUAGES;
}

/** The first language an `Accept-Language` value names that is offered, else the source. Any `q` above 0 counts; the header's order breaks ties. */
export function languageFromHeader(
  header: string | undefined,
  env: RuntimeEnv = process.env,
): Language {
  const wanted = (header ?? "")
    .split(",")
    .map((part, order) => {
      const [tag, ...params] = part.split(";");
      const q = params
        .map((param) => /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(param)?.[1])
        .find((value) => value !== undefined);
      return { tag: tag.trim(), q: q === undefined ? 1 : Number(q), order };
    })
    .filter(({ tag, q }) => tag !== "" && q > 0)
    .sort((a, b) => b.q - a.q || a.order - b.order)
    .map(({ tag }) => tag);
  return matchLanguage(wanted, offeredLanguages(env));
}

/** The language a message for this account is written in: the one its client last ran in, else the source. */
export function languageOfAccount(
  uiPreferences: unknown,
  env: RuntimeEnv = process.env,
): Language {
  const stored = normalizeUserUiPreferences(uiPreferences).language;
  return stored !== undefined && offeredLanguages(env).includes(stored)
    ? stored
    : SOURCE_LANGUAGE;
}

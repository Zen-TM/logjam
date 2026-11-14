// User-facing text goes through `t`, `plural`, `rich` or `say`, which look the
// English up in the catalogue of the language in force. The reasoning, and why
// there is no library, is docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md.
// shared/src/i18n.test.ts holds how these functions behave;
// shared/src/i18nCoverage.test.ts (and one per package) holds that text outside
// them does not grow.
import { enUS } from "./i18nCatalogues/en-US.js";

/** The language the code is written in: a message with no entry reads as itself. */
export const SOURCE_LANGUAGE = "en-AU";
/** Generated, never written: the source with every letter accented, padded and wrapped in ⟦ ⟧, for development. `language()` accepts it anywhere; nothing refuses it in a prod runtime yet. */
export const PSEUDO_LANGUAGE = "en-XA";
export const LANGUAGES = ["en-AU", "en-US", "en-XA"] as const;
export type Language = (typeof LANGUAGES)[number];

type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

/**
 * Messages that differ from the English, by key. A plural key holds an object
 * of CLDR categories, so a language with `few` or `many` needs no call-site change.
 */
export type Catalogue = Readonly<
  Record<string, string | Partial<Record<PluralCategory, string>>>
>;

// A language with no entry here reads as its source (en-AU, en-XA).
const CATALOGUES: Partial<Record<Language, Catalogue>> = { "en-US": enUS };

/** For the languages whose plural rules `Intl.PluralRules` may be missing (Hermes). One per `Language`, so adding one fails the build until it has a rule. */
const BUILT_IN_PLURAL_RULE: Record<Language, (n: number) => PluralCategory> = {
  "en-AU": (n) => (n === 1 ? "one" : "other"),
  "en-US": (n) => (n === 1 ? "one" : "other"),
  "en-XA": (n) => (n === 1 ? "one" : "other"),
};

type Resolver = () => string | undefined;
let resolver: Resolver = () => undefined;

/** The API sets this once, to read the language of the request in hand from AsyncLocalStorage. */
export function setLanguageResolver(read: Resolver): void {
  resolver = read;
}

function isLanguage(value: unknown): value is Language {
  return LANGUAGES.includes(value as Language);
}

/**
 * The language in force: the API's per-request one, else the one the client
 * started in (`globalThis.LOGJAM_LANGUAGE`, set before this package loads
 * because contract text is evaluated at import).
 */
export function language(): Language {
  const wanted =
    resolver() ?? (globalThis as { LOGJAM_LANGUAGE?: string }).LOGJAM_LANGUAGE;
  return isLanguage(wanted) ? wanted : SOURCE_LANGUAGE;
}

/** What to hand `Intl.*`: the language, with the pseudo-language read as the source. */
export function intlLocale(): string {
  const current = language();
  return current === PSEUDO_LANGUAGE ? SOURCE_LANGUAGE : current;
}

/** The first of `wanted` (BCP 47 tags, `en_US` and `en-us` too) that is exactly one of `offered`, else the source. */
export function matchLanguage(
  wanted: readonly string[],
  offered: readonly Language[],
): Language {
  for (const tag of wanted) {
    const normal = tag.trim().replace(/_/g, "-").toLowerCase();
    const found = offered.find((language) => language.toLowerCase() === normal);
    if (found) return found;
  }
  return SOURCE_LANGUAGE;
}

const ACCENTED: Record<string, string> = {
  a: "á",
  e: "é",
  i: "í",
  o: "ó",
  u: "ú",
  y: "ý",
  c: "ç",
  n: "ñ",
  s: "š",
  z: "ž",
  A: "Á",
  E: "É",
  I: "Í",
  O: "Ó",
  U: "Ú",
  Y: "Ý",
  C: "Ç",
  N: "Ñ",
  S: "Š",
  Z: "Ž",
};

/** The pseudo-language: holes (`{0}`), tags (`<a>`) and `#` are left as they are. */
export function pseudo(text: string): string {
  let letters = 0;
  const body = text.replace(/\{\d+\}|<\/?[a-z][a-z0-9]*>|#|[A-Za-z]/g, (m) => {
    if (m.length > 1 || m === "#") return m;
    letters++;
    return ACCENTED[m] ?? m;
  });
  const padding = "~".repeat(Math.ceil(letters * 0.35));
  return `⟦${body}${padding}⟧`;
}

/** The catalogue key of a template's literal parts: the English with each hole written `{0}`, `{1}`, … The scanner (i18nSource.ts) keys messages with this too. */
export function templateKey(strings: readonly string[]): string {
  let text = strings[0];
  for (let i = 1; i < strings.length; i++) text += `{${i - 1}}${strings[i]}`;
  return text;
}

const keys = new WeakMap<TemplateStringsArray, string>();

function keyOf(strings: TemplateStringsArray): string {
  let text = keys.get(strings);
  if (text === undefined) {
    text = templateKey(strings);
    keys.set(strings, text);
  }
  return text;
}

function entry(lang: Language, message: string) {
  const catalogue = CATALOGUES[lang];
  // A key such as "constructor" finds a function, which no caller accepts as text.
  return catalogue?.[message];
}

/** `message` in the language in force, holes still written `{0}`, `{1}`, … */
function localise(message: string): string {
  const lang = language();
  if (lang === PSEUDO_LANGUAGE) return pseudo(message);
  const found = entry(lang, message);
  return typeof found === "string" ? found : message;
}

/** Put `holes` where the text says `{0}`, `{1}`, … in whatever order it says them. */
export function fillHoles(
  text: string,
  holes: readonly (string | number)[],
): string {
  return text.replace(/\{(\d+)\}/g, (whole, i) =>
    Number(i) < holes.length ? String(holes[i]) : whole,
  );
}

/**
 * The template for `say`: its English looked up, holes still `{0}`. `say` adds
 * the “ ” round a quoted hole after this, so no catalogue can change the marks
 * `withoutQuoted` depends on (held by "keeps the user's words and their “ ” in
 * every language" in i18n.test.ts).
 */
export function localisedTemplate(strings: TemplateStringsArray): string {
  return localise(keyOf(strings));
}

/** t`Showing ${shown} of ${total}`: the key is "Showing {0} of {1}". A translation may reorder the holes. */
export function t(
  strings: TemplateStringsArray,
  ...holes: (string | number)[]
): string {
  return fillHoles(localise(keyOf(strings)), holes);
}

const pluralRules = new Map<string, Intl.PluralRules>();

/** The CLDR category of `count`: `Intl.PluralRules` where the runtime has it, else the built-in rule. */
export function pluralCategory(
  count: number,
  lang: Language = language(),
): PluralCategory {
  const locale = lang === PSEUDO_LANGUAGE ? SOURCE_LANGUAGE : lang;
  if (typeof Intl !== "undefined" && typeof Intl.PluralRules === "function") {
    let rules = pluralRules.get(locale);
    if (!rules) {
      rules = new Intl.PluralRules(locale);
      pluralRules.set(locale, rules);
    }
    return rules.select(count);
  }
  return BUILT_IN_PLURAL_RULE[lang](count);
}

/**
 * plural(n, "# place in {0}", "# places in {0}", name): `#` is the count. The
 * key is the `other` form. A language with no entry reads the English, picked
 * by the English rule.
 */
export function plural(
  count: number,
  one: string,
  other: string,
  ...holes: (string | number)[]
): string {
  const lang = language();
  const english =
    BUILT_IN_PLURAL_RULE[SOURCE_LANGUAGE](count) === "one" ? one : other;
  let text: string;
  if (lang === PSEUDO_LANGUAGE) {
    text = pseudo(english);
  } else {
    const found = entry(lang, other);
    text =
      typeof found === "object"
        ? (found[pluralCategory(count, lang)] ?? found.other ?? english)
        : typeof found === "string"
          ? found
          : english;
  }
  // `#` first: a hole that holds a `#` must stay as written.
  return fillHoles(text.replace(/#/g, String(count)), holes);
}

export type RichPart = string | { tag: string; text: string };

/** An element in a `rich` message: `<a>text and {0}</a>`. `rich` and the scanner (i18nSource.ts) read tags with this one pattern. */
export const RICH_TAG = /<([a-z][a-z0-9]*)>([^<]*)<\/\1>/g;

/**
 * A sentence with an element in it, as parts:
 * rich`Read the <a>${name}</a>.` is ["Read the ", { tag: "a", text: name }, "."].
 * The tags are found in the message after the catalogue lookup and before the
 * holes go in, so a hole holding `<` or `<b>x</b>` is only ever text. A tag
 * holds text and holes, never another tag; a nested or unclosed tag stays in
 * the text as written, which i18n.test.ts pins.
 */
export function rich(
  strings: TemplateStringsArray,
  ...holes: (string | number)[]
): RichPart[] {
  const message = localise(keyOf(strings));
  const parts: RichPart[] = [];
  const text = (from: number, to: number) => {
    const filled = fillHoles(message.slice(from, to), holes);
    if (filled) parts.push(filled);
  };
  let from = 0;
  for (const m of message.matchAll(RICH_TAG)) {
    text(from, m.index);
    parts.push({ tag: m[1], text: fillHoles(m[2], holes) });
    from = m.index + m[0].length;
  }
  text(from, message.length);
  return parts;
}

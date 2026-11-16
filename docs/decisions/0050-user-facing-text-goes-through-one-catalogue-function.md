# 0050. User-facing text goes through one catalogue function, keyed by its English

- **Date:** 2026-11-14
- **Status:** Accepted
- **Supersedes:** —

## Context

Logjam Web, Logjam GPS and the API write every sentence a user reads as a
literal in the source: about 4,000 messages, roughly 1,200 in `frontend/src`,
1,330 in `mobile/src`, 1,200 in `shared/src` and 300 in `api/src`. Roughly 1,075
of the `shared/src` strings, almost all in `shared/src/contracts/`, are
evaluated when the module loads, so the language has to be known before
`@logjam/shared` is imported. The API writes the sentence a user reads when it
refuses a request ([0033](0033-the-api-writes-the-sentence-a-user-reads.md)),
and answers many requests at once, so its language is per request, not per
process.

On 2026-11-14 the maintainer decided that language support goes in now as
infrastructure: English stays the source text, a generated pseudo-language
exists for dev only, and US English is the first real second language. No other
translations. The Australian wording ("abseil", "metre") is what differs.

## Decision

User-facing text is written through `t`, `plural`, `rich` or `say`
(`shared/src/i18n.ts`), and nothing else decides what language it is in.

- **The English text is the key.** `` t`Showing ${shown} of ${total}` `` looks
  up `"Showing {0} of {1}"` in the catalogue of the language in force and
  returns the English when there is no entry. `say` (`shared/src/userSentence.ts`)
  looks its template up the same way and sets the “ ” round a quoted hole after
  the lookup, so no catalogue can change the marks `withoutQuoted` depends on.
  A plural is `plural(n, one, other, …holes)`, keyed by `other`; a catalogue
  entry for it is an object of CLDR categories. A sentence with an element in
  it is one message, ``rich`Read the <a>${name}</a>.` ``, which returns the parts of
  the sentence. The tags are found in the message before its holes are filled,
  so a hole is only ever text.
- **The source language is `en-AU`.** A catalogue holds differences only
  (`shared/src/i18nCatalogues/en-US.ts`). `en-XA`, the pseudo-language, is
  computed (`pseudo`): accented letters, padding and ⟦ ⟧, with holes, tags and
  `#` left alone, so text that skipped the catalogue is visible at a glance.
- **The language is fixed when a client starts.** `language()` reads
  `globalThis.LOGJAM_LANGUAGE`, which each client's entry file sets from
  synchronous storage before it imports `@logjam/shared`. Changing the language
  stores the choice and reloads. In the API, `setLanguageResolver` reads the
  request's language from `AsyncLocalStorage`, and text evaluated at import
  stays English.
- **No library.** The mechanism is `shared/src/i18n.ts`.
- **Update 2026-11-16: a message may be a pattern with named parts.** Two forms
  whose holes are numbered alike share one key and could not be translated
  apart (the day forms: "Sat 8 Nov" and "15 Mar 2026" are both `{0} {1} {2}`).
  Each is written as a pattern, `` t`<weekday> <day> <month>` ``, which `fill`
  in `shared/src/dateFormat.ts` completes after the lookup. A catalogue entry
  for it rewrites the order and punctuation and keeps the same part names,
  each once; a misspelt part stays in the text as written. Guard:
  `shared/src/dateCatalogues.test.ts` ("keep the part names of the English")
  for every catalogue and the pseudo-language, and `shared/src/dateFormat.test.ts`
  ("give every form a message of its own") for two forms sharing a pattern.
  Everything else above stands.
- **Update 2026-11-16: text the API sends is written per call, and a value that
  code compares or stores stays English.** Four rules; each says what guards it, or that nothing does.
  (1) A `t` in a module-level constant freezes the language known at import,
  which is English in the API, so text the API sends to a user is a function or
  a getter read when it is used (`placeKindLabel` in
  `shared/src/placeRegistry.ts`). Guards: `api/src/sharedFrozenText.unit.test.ts`
  ("holds no text frozen in the language the process started in") for every
  value the API imports from `@logjam/shared`, and `shared/src/placeRegistry.test.ts`
  ("follows the language in force when it is called, which the API sends") for
  a function that reads a table. (2) A literal that reads as words but is a
  value code matches, stores or sends as a code is not a message and stays as
  written: the sign-up cap sentence matched against the pre-sign-up Lambda's
  text, the import failure codes, the stored names and hints of the built-in
  place types, a source's name that the API stores in a place's sources. Guard:
  `shared/src/apiErrors.test.ts` ("still maps the refusal when the page started
  in another language") for the first; for the others, only the flag described
  below. (3) Developer detail, text given to `malformed` or logged, stays bare;
  likewise only that flag. (4) A data
  source's credit stays as its publisher wrote it, plain and HTML alike, so the
  two agree in every language; no test holds that they agree. Rules 2 to 4 name
  what they leave as written in `DATA_LITERALS` (by file, so the same words
  elsewhere are still counted) or `EXEMPT_FILES` (`shared/src/i18nSource.ts`),
  each with its reason. For a value listed there, wrapping it in `t` turns
  `shared/src/i18nCoverage.test.ts` ("lists only literals that exist, in the
  file that holds them") red, because the file no longer holds the literal;
  that flags the change but does not hold the rule, since deleting the entry
  makes the test green. For anything not listed, nothing does. The region declaration's vocabulary (tenure classes, fire types,
  caveats, the world's name) is written when the module loads, so it follows
  the language a client started in, and the API reads only ids and numbers from
  it; the first guard lists `REGIONS` as safe on that ground, so no test holds
  it. Everything else above stands.

Guard: `shared/src/i18n.test.ts` holds the mechanism (key, reorder, fallback,
plural categories with and without `Intl.PluralRules`, pseudo, `say`'s marks,
`matchLanguage`). `i18nCoverage.test.ts` in each package holds that the text
written outside these functions does not grow: a ceiling of bare literals per
directory that may only fall, found by `shared/src/i18nSource.ts`; the same
tests hold each message to its hygiene rules (no leading or trailing space, no
literal `{0}`, a `#` in a plural, only tags `rich` can consume). On Logjam
Web's main screens, started in the pseudo-language, text that is outside ⟦ ⟧
and not in `frontend/e2e/pseudo-unwrapped.json` fails
`frontend/e2e/pseudo.spec.ts`, and so does an entry of that list that no screen
shows any more; so does a label wider than its control that is not in
`frontend/e2e/pseudo-overflows.json` (which depends on the machine's fonts, so
its entries that fit are no failure). No test yet
holds that every call site uses it, since existing literals are not converted,
or that the API's resolver is installed from `AsyncLocalStorage` for every
path that writes text; a later change adds it. Each client's entry file sets
the global before it imports `@logjam/shared`
(`frontend/src/language.test.ts`, `frontend/src/mainLanguage.test.ts`,
`mobile/src/language.test.ts`). The API installs the resolver and refuses the
pseudo-language in a prod runtime (`api/src/lib/requestLanguage.unit.test.ts`,
`api/src/middleware/language.unit.test.ts`), and both clients refuse it where
the simulated regions are off (`frontend/src/languageSetting.test.ts`,
`mobile/src/languageSetting.test.ts`). No `say` literal in `api/src` or
`shared/src` sits outside a function (`api/src/userCopy.unit.test.ts`). The
announcement's push title, which the API reads for each recipient, is a
getter, so it is written when read, not when its module loads. So is the plan
form builder's locked-visibility sentence, which the clients read, so that no
`say` sentence function is called at import
(`shared/src/contracts/contractLanguage.test.ts`).
(updated 2026-11-16)

## Consequences

- **Positive:** a string is its own key, so a call site reads as it did and no
  id is invented or kept in step. Holes are typed by the template. Nothing
  loads at build time: `shared` and the API still build with plain `tsc`.
- **Negative:** one English text cannot have two translations until a key gains
  a context. Rewording an English message orphans its `en-US` entry;
  `shared/src/i18nCoverage.test.ts` fails on it. (updated 2026-11-14) A language change
  reloads Logjam Web and Logjam GPS. There are no translator tools: a
  translation platform would need a script that exports the catalogue.
- **Neutral:** `en-US` is empty until existing literals are moved into the catalogue. With one
  region in prod no language setting shows. A message in the topo worker, the
  sign-up code mail and the static pages stays English.

## Alternatives considered

- **i18next with react-i18next, Lingui or FormatJS.** The obvious route, and
  still reasonable. None of them settles the three hard parts: strings
  evaluated at import (each needs the same start-up trick), the API's
  per-request language (each still needs `AsyncLocalStorage`), and moving 4,000
  strings. i18next and FormatJS keys are ids and its holes are untyped
  strings; Lingui keeps the English as the key but needs a Babel or SWC macro in
  every build, and `shared` and the API build with plain `tsc`. Hermes's `Intl`
  support is incomplete (`shared/src/dateNames.ts` already writes month names
  by hand for that reason), so each may need a polyfill for plurals. What they add, translator tooling
  and ICU select, is not needed for US English and a pseudo-language.
- **Ids as keys** (`plans.title.rename`). Survives rewording, but every
  call site changes shape and a second list of names has to stay in step with
  the text.
- **Live switching.** It would make the 1,075 import-time strings lazy: a proxy
  over every contract object, or descriptors and a changed type at every use.
  A reload costs a setting people touch once.
- **Wrap every literal in `shared`, values code compares included.** The
  count would reach zero without a list, but a value matched against another
  program's English (the sign-up cap, an import failure code, a credit the
  topo build writes too) stops matching in any other language, and a built-in
  place type's name is written to a row, so the row would hold the language the
  seed ran in.
- **Reason codes from the API, with the clients writing the sentence.** Already
  rejected by [0033](0033-the-api-writes-the-sentence-a-user-reads.md): two
  sentence lists and a code list that must agree.

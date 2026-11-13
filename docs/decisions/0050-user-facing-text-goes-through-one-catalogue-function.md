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

Guard: `shared/src/i18n.test.ts` holds the mechanism (key, reorder, fallback,
plural categories with and without `Intl.PluralRules`, pseudo, `say`'s marks,
`matchLanguage`). No test yet holds that call sites use it; the coverage tests
of the extraction work do.

## Consequences

- **Positive:** a string is its own key, so a call site reads as it did and no
  id is invented or kept in step. Holes are typed by the template. Nothing
  loads at build time: `shared` and the API still build with plain `tsc`.
- **Negative:** one English text cannot have two translations until a key gains
  a context. Rewording an English message orphans its `en-US` entry. No test
  catches that yet; the scanner slice of the extraction work adds it. A language change
  reloads Logjam Web and Logjam GPS. There are no translator tools: a
  translation platform would need a script that exports the catalogue.
- **Neutral:** `en-US` is empty until the extraction moves the copy. With one
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
- **Reason codes from the API, with the clients writing the sentence.** Already
  rejected by [0033](0033-the-api-writes-the-sentence-a-user-reads.md): two
  sentence lists and a code list that must agree.

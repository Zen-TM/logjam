// A date form's English is a pattern with named parts (`<weekday> <day> <month>`), which
// dateFormat.ts fills after the catalogue lookup. A catalogue entry that misspells a
// part, drops one or repeats one would put `<dya>` or a missing day in front of a user,
// so each language's entry for a pattern keeps the parts of its English
// (docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type Catalogue,
  LANGUAGES,
  PSEUDO_LANGUAGE,
  pseudo,
  SOURCE_LANGUAGE,
} from "./i18n.js";
import { enUS } from "./i18nCatalogues/en-US.js";

// Every language with a catalogue file: one more in LANGUAGES fails the last test until it is listed here.
const CATALOGUES: Record<string, Catalogue> = { "en-US": enUS };

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "dateFormat.ts"),
  "utf8",
);
const PATTERNS = [...source.matchAll(/fill\(t`([^`]+)`/g)].map((m) => m[1]);
const parts = (text: string) => (text.match(/<[^<>]*>/g) ?? []).sort();

describe("the date patterns in a catalogue", () => {
  // Mutation: add `"<day> <month> <year>": "<month> <dya>, <year>"` to en-US.ts.
  it("keep the part names of the English", () => {
    expect(PATTERNS.length).toBeGreaterThanOrEqual(12);
    for (const [language, catalogue] of Object.entries(CATALOGUES)) {
      for (const pattern of PATTERNS) {
        const entry = catalogue[pattern];
        if (entry === undefined) continue;
        expect(typeof entry, `${language} ${pattern}`).toBe("string");
        expect(parts(entry as string), `${language} ${pattern}`).toEqual(
          parts(pattern),
        );
      }
    }
  });

  // Mutation: let `pseudo` accent the letters inside a `<tag>`, so `<day>` becomes `<dáý>`.
  it("keep their part names in the pseudo-language", () => {
    for (const pattern of PATTERNS) {
      expect(parts(pseudo(pattern)), pattern).toEqual(parts(pattern));
    }
  });

  // Mutation: add a language to `LANGUAGES` without listing its catalogue here.
  it("are checked for every language that has a catalogue", () => {
    const withCatalogue = LANGUAGES.filter(
      (language) =>
        language !== SOURCE_LANGUAGE && language !== PSEUDO_LANGUAGE,
    );
    expect([...withCatalogue].sort()).toEqual(Object.keys(CATALOGUES).sort());
  });
});

// The catalogue function (docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md). Each guard names the
// mutation that turns it red.
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as I18n from "./i18n";

// en-US is empty in source; these are the differences the tests need.
vi.mock("./i18nCatalogues/en-US.js", () => ({
  enUS: {
    "{0} {1} {2}": "{1} {0}, {2}",
    "Couldn't find {0}.": "Can't find {0}.",
    "Abseil down {0}": "Rappel down {0}",
    "Read <a>{0}</a> now": "Now <a>{0}</a>, read {0}",
    "# places in {0}": { one: "# spot in {0}", few: "# spots (few) in {0}" },
  },
}));

// Each test gets its own copy of the module: it caches PluralRules.
async function load() {
  vi.resetModules();
  const i18n: typeof I18n = await import("./i18n");
  const sentence = await import("./userSentence");
  return { ...i18n, ...sentence };
}

afterEach(() => {
  delete (globalThis as { LOGJAM_LANGUAGE?: string }).LOGJAM_LANGUAGE;
  vi.unstubAllGlobals();
});

function use(lang: string) {
  (globalThis as { LOGJAM_LANGUAGE?: string }).LOGJAM_LANGUAGE = lang;
}

describe("t", () => {
  // Mutation: make `localise` return something other than `message` in the source language.
  it("reads as the English in the source language", async () => {
    const { t } = await load();
    expect(t`Showing ${3} of ${5}`).toBe("Showing 3 of 5");
    expect(t`No holes`).toBe("No holes");
    expect(t`${"a"}${"b"}`).toBe("ab");
  });

  // Mutation: build the key with `${i}` instead of `{${i - 1}}`, or join the parts with "".
  it("keys a message by its English with numbered holes", async () => {
    const { t } = await load();
    use("en-US");
    expect(t`Abseil down ${"Claustral"}`).toBe("Rappel down Claustral");
  });

  // Mutation: fill holes in the order they were passed, ignoring the numbers in the translation.
  it("lets a translation reorder its holes", async () => {
    const { t } = await load();
    use("en-US");
    expect(t`${"12"} ${"Nov"} ${"2026"}`).toBe("Nov 12, 2026");
  });

  // Mutation: return "" or undefined for a message the catalogue lacks.
  it("falls back to the English when the catalogue has no entry", async () => {
    const { t } = await load();
    use("en-US");
    expect(t`Not in the catalogue ${1}`).toBe("Not in the catalogue 1");
  });

  // Mutation: return `found` from `localise` without the typeof check.
  it("never reads a prototype member as text", async () => {
    const { t } = await load();
    use("en-US");
    expect(t`constructor`).toBe("constructor");
    expect(t`__proto__`).toBe("__proto__");
  });

  // Mutation: replace in a loop, so a hole's text is searched for `{n}` again.
  it("does not expand a hole's own braces", async () => {
    const { t } = await load();
    expect(t`A ${"{1}"} B ${"x"}`).toBe("A {1} B x");
  });
});

describe("language", () => {
  // Mutation: make `isLanguage` return true for anything.
  it("is the source unless the start-up global names an offered language", async () => {
    const { language, intlLocale } = await load();
    expect(language()).toBe("en-AU");
    use("fr");
    expect(language()).toBe("en-AU");
    use("en-US");
    expect(language()).toBe("en-US");
    expect(intlLocale()).toBe("en-US");
  });

  // Mutation: return the language itself from `intlLocale` for the pseudo-language.
  it("hands Intl the source for the pseudo-language", async () => {
    const { intlLocale } = await load();
    use("en-XA");
    expect(intlLocale()).toBe("en-AU");
  });

  // Mutation: read the global before the resolver.
  it("prefers the API's per-request language to the start-up one", async () => {
    const { language, setLanguageResolver } = await load();
    use("en-US");
    setLanguageResolver(() => "en-XA");
    expect(language()).toBe("en-XA");
    setLanguageResolver(() => undefined);
    expect(language()).toBe("en-US");
  });
});

describe("inSourceLanguage", () => {
  // Mutation: return `render()` without pinning the language, and a stored
  // English sentence no longer equals the sentence rendered to compare with it.
  it("writes in the source language whatever is in force, and puts the language back", async () => {
    const { inSourceLanguage, language, t } = await load();
    use("en-XA");
    const render = () => t`Couldn't find that place.`;
    expect(render()).not.toBe("Couldn't find that place.");
    expect(inSourceLanguage(render)).toBe("Couldn't find that place.");
    expect(language()).toBe("en-XA");
  });

  // Mutation: drop the `finally`, and a render that throws leaves every later
  // message in the source language.
  it("puts the language back when the render throws", async () => {
    const { inSourceLanguage, language } = await load();
    use("en-US");
    expect(() =>
      inSourceLanguage(() => {
        throw new Error("render failed");
      }),
    ).toThrow("render failed");
    expect(language()).toBe("en-US");
  });
});

describe("matchLanguage", () => {
  const offered = ["en-AU", "en-US"] as const;
  // Mutation: match on the primary subtag only (so en-NZ matches en-US), or skip the `_` and case folding.
  it.each([
    [["en-US"], "en-US"],
    [["en_US"], "en-US"],
    [["en-us"], "en-US"],
    [["en-NZ"], "en-AU"],
    [["fr"], "en-AU"],
    [["fr", "en-US"], "en-US"],
    [[], "en-AU"],
    [[""], "en-AU"],
  ])("%j gives %s", (wanted, expected) => {
    return load().then(({ matchLanguage }) => {
      expect(matchLanguage(wanted, offered)).toBe(expected);
    });
  });

  // Mutation: search LANGUAGES instead of `offered`.
  it("offers only what it is given", async () => {
    const { matchLanguage } = await load();
    expect(matchLanguage(["en-XA"], offered)).toBe("en-AU");
    expect(matchLanguage(["en-US"], ["en-AU"])).toBe("en-AU");
  });
});

describe("plural", () => {
  // Mutation: pick `one` for 0, or for every count.
  it("picks the English form and fills # and holes", async () => {
    const { plural } = await load();
    const f = (n: number) =>
      plural(n, "# canyon in {0}", "# canyons in {0}", "NSW");
    expect(f(1)).toBe("1 canyon in NSW");
    expect(f(0)).toBe("0 canyons in NSW");
    expect(f(2)).toBe("2 canyons in NSW");
  });

  // Mutation: fill holes before `#`, so a hole holding "#" becomes the count.
  it("does not read a # in a hole as the count", async () => {
    const { plural } = await load();
    expect(plural(3, "# in {0}", "# in {0}", "#7")).toBe("3 in #7");
  });

  // Mutation: key the entry by the `one` form, or ignore the language's categories.
  it("reads a catalogue entry by category, falling back to other, then to English", async () => {
    vi.stubGlobal("Intl", {
      PluralRules: class {
        select(n: number) {
          return n === 1 ? "one" : n === 3 ? "few" : "other";
        }
      },
    });
    const { plural } = await load();
    use("en-US");
    const f = (n: number) =>
      plural(n, "# place in {0}", "# places in {0}", "Utah");
    expect(f(1)).toBe("1 spot in Utah");
    expect(f(3)).toBe("3 spots (few) in Utah");
    // The entry has no `other`, so English is used, with the English rule.
    expect(f(2)).toBe("2 places in Utah");
  });

  // Mutation: delete a language's entry from BUILT_IN_PLURAL_RULE (or add a language to LANGUAGES without a rule).
  it("has a built-in rule for every language when Intl.PluralRules is missing", async () => {
    vi.stubGlobal("Intl", undefined);
    const { LANGUAGES, pluralCategory } = await load();
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(3);
    for (const lang of LANGUAGES) {
      expect(pluralCategory(1, lang), lang).toBe("one");
      expect(pluralCategory(2, lang), lang).toBe("other");
      expect(pluralCategory(0, lang), lang).toBe("other");
    }
  });

  // Mutation: make `pluralCategory` read the built-in rule before Intl.
  it("asks Intl.PluralRules when the runtime has it", async () => {
    const { pluralCategory, LANGUAGES } = await load();
    for (const lang of LANGUAGES) expect(pluralCategory(2, lang)).toBe("other");
    vi.stubGlobal("Intl", {
      PluralRules: class {
        select() {
          return "many";
        }
      },
    });
    const fresh = await load();
    expect(fresh.pluralCategory(2, "en-US")).toBe("many");
  });
});

describe("pseudo-language", () => {
  // Mutation: let the accent map touch holes or tags, or drop the wrapper.
  it("accents, pads and wraps, leaving holes, tags and # alone", async () => {
    const { pseudo } = await load();
    expect(pseudo("Showing {0} of {1}")).toBe("⟦Šhówíñg {0} óf {1}~~~~⟧");
    expect(pseudo("# places <a>here</a>")).toBe("⟦# pláçéš <a>héré</a>~~~~⟧");
    expect(pseudo("{0}")).toBe("⟦{0}⟧");
  });

  // Mutation: compute the pseudo-language only for `t`, not for `plural`.
  it("applies to t, plural and say", async () => {
    const { t, plural, say } = await load();
    use("en-XA");
    expect(t`Showing ${3} of ${5}`).toBe("⟦Šhówíñg 3 óf 5~~~~⟧");
    expect(plural(3, "# place", "# places")).toBe("⟦3 pláçéš~~~⟧");
    expect(say`Hello`).toBe("⟦Hélló~~⟧");
  });

  // Mutation: change the tag pattern in `pseudo` and `rich` so they disagree.
  it("keeps its tags, so `rich` still splits it", async () => {
    const { rich } = await load();
    use("en-XA");
    const parts = rich`Read the <a>terms</a>, please.`;
    expect(parts).toHaveLength(3);
    expect(parts[1]).toEqual({ tag: "a", text: "térmš" });
    expect(parts[0]).toMatch(/^⟦/);
    expect(parts[2]).toMatch(/⟧$/);
  });
});

describe("rich", () => {
  // Mutation: return the message whole, or lose the text after the last tag.
  it("splits a sentence round its tags and fills the holes in each part", async () => {
    const { rich } = await load();
    expect(rich`Read the <a>terms</a>.`).toEqual([
      "Read the ",
      { tag: "a", text: "terms" },
      ".",
    ]);
    expect(rich`<b>One</b><i>two</i>`).toEqual([
      { tag: "b", text: "One" },
      { tag: "i", text: "two" },
    ]);
    expect(rich`${"Ann"} read <a>${"the terms"} (${2})</a>`).toEqual([
      "Ann read ",
      { tag: "a", text: "the terms (2)" },
    ]);
    expect(rich`No tags, 2 < 3`).toEqual(["No tags, 2 < 3"]);
    expect(rich``).toEqual([]);
  });

  // Mutation: split the message after the holes are filled.
  it("never reads a hole as markup", async () => {
    const { rich } = await load();
    expect(rich`<a>${"a<b"}</a>`).toEqual([{ tag: "a", text: "a<b" }]);
    expect(rich`Read ${"<b>x</b>"} now`).toEqual(["Read <b>x</b> now"]);
  });

  // Mutation: reorder through the catalogue only for `t`, not `rich`.
  it("reads the catalogue, so a translation can move the tag", async () => {
    const { rich } = await load();
    use("en-US");
    expect(rich`Read <a>${"x"}</a> now`).toEqual([
      "Now ",
      { tag: "a", text: "x" },
      ", read x",
    ]);
  });

  // Mutation: let a tag's text match across `<` (`([^<]*)` becomes `([\s\S]*?)`).
  it("leaves nested and unclosed tags in the text", async () => {
    const { rich } = await load();
    expect(rich`<a>one <b>two</b></a>`).toEqual([
      "<a>one ",
      { tag: "b", text: "two" },
      "</a>",
    ]);
    expect(rich`<a>open`).toEqual(["<a>open"]);
  });
});

describe("say", () => {
  // Mutation: fill the holes before the lookup, set the “ ” inside the lookup, or stop looking `say`'s template up.
  it("keeps the user's words and their “ ” in every language", async () => {
    const { LANGUAGES, say, quote, withoutQuoted } = await load();
    for (const lang of LANGUAGES) {
      use(lang);
      const sentence = say`Couldn't find ${quote("Abseil")}.`;
      expect(sentence, lang).toContain("“Abseil”");
      expect(withoutQuoted(sentence), lang).toContain("“…”");
      expect(withoutQuoted(sentence), lang).not.toContain("Abseil");
    }
    use("en-US");
    expect(say`Couldn't find ${quote("Abseil")}.`).toBe("Can't find “Abseil”.");
    use("en-XA");
    expect(say`Couldn't find ${quote("Abseil")}.`).toBe(
      "⟦Çóúldñ't fíñd {0}.~~~~⟧".replace("{0}", "“Abseil”"),
    );
  });

  // Mutation: stop trimming a quoted hole in `say` (`hole.quoted.trim()` becomes `hole.quoted`).
  it("reads as the English in the source language, with numbers and sentences as holes", async () => {
    const { say, quote } = await load();
    const inner = say`inner`;
    expect(say`Found ${2} in ${inner}, ${quote(" Spaced ")}.`).toBe(
      "Found 2 in inner, “Spaced”.",
    );
  });
});

describe("the languages", () => {
  // Mutation: remove the pseudo-language or the source from LANGUAGES.
  it("include the source and the pseudo-language", async () => {
    const { LANGUAGES, SOURCE_LANGUAGE, PSEUDO_LANGUAGE } = await load();
    expect(LANGUAGES).toContain(SOURCE_LANGUAGE);
    expect(LANGUAGES).toContain(PSEUDO_LANGUAGE);
    expect(LANGUAGES).toContain("en-US");
  });
});

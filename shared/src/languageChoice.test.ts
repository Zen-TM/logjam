// Which languages a client offers and starts in (languageChoice.ts). Each guard
// names the mutation that turns it red.
import { describe, expect, it } from "vitest";
import type { Language } from "./i18n";
import {
  languageToRecord,
  languageToStart,
  offeredLanguages,
  wantedLanguage,
} from "./languageChoice";
import { LANGUAGES } from "./i18n";
import { NSW_REGION, REGIONS } from "./regions";
import { SIM_REGIONS, SIM_UTAH } from "./simRegions";

const ALL: readonly Language[] = ["en-AU", "en-US", "en-XA"];

describe("offeredLanguages", () => {
  // Mutation: change `if (dev)` to `if (true)` in offeredLanguages.
  it("offers the source alone in prod: one region, no dev", () => {
    expect(REGIONS.map((r) => r.id)).toEqual(["nsw"]);
    expect(offeredLanguages(false)).toEqual(["en-AU"]);
    expect(offeredLanguages(false, [NSW_REGION])).toEqual(["en-AU"]);
  });

  // Mutation: delete the `for (const region of regions)` loop in offeredLanguages.
  it("adds each language a region declares, once, in region order", () => {
    expect(offeredLanguages(false, [NSW_REGION, ...SIM_REGIONS])).toEqual([
      "en-AU",
      "en-US",
    ]);
    expect(offeredLanguages(false, [SIM_UTAH, SIM_UTAH])).toEqual([
      "en-AU",
      "en-US",
    ]);
  });

  // Mutation: delete the `!offered.includes(lang)` test in offeredLanguages.
  it("does not list a language twice when two regions declare it", () => {
    const again = { ...SIM_UTAH, id: "again" };
    expect(offeredLanguages(false, [SIM_UTAH, again])).toEqual([
      "en-AU",
      "en-US",
    ]);
  });

  // Mutation: delete the `if (dev) offered.push(PSEUDO_LANGUAGE)` line.
  it("adds the pseudo-language last when dev", () => {
    expect(offeredLanguages(true, [NSW_REGION, ...SIM_REGIONS])).toEqual(ALL);
  });

  // Mutation: delete `lang !== PSEUDO_LANGUAGE &&` in offeredLanguages.
  it("never takes the pseudo-language from a region, nor an unknown tag", () => {
    const odd = { ...SIM_UTAH, languages: ["en-XA", "fr", "xx"] };
    expect(offeredLanguages(false, [odd])).toEqual(["en-AU"]);
  });

  // Mutation: compare `l === tag` without `toLowerCase()` in offeredLanguages.
  it("reads a tag in any case", () => {
    const lower = { ...SIM_UTAH, languages: ["en-us"] };
    expect(offeredLanguages(false, [lower])).toEqual(["en-AU", "en-US"]);
  });

  // Mutation: set SIM_UTAH's `languages` to ["en-ZZ"] in simRegions.ts.
  it("every tag a declared region carries is a language the catalogue knows", () => {
    const declared = [NSW_REGION, ...SIM_REGIONS].flatMap(
      (r) => r.languages ?? [],
    );
    expect(declared.length).toBeGreaterThanOrEqual(1);
    for (const tag of declared) expect(LANGUAGES).toContain(tag);
  });
});

describe("wantedLanguage", () => {
  // Mutation: build the list from `device` alone, ignoring `stored`, in wantedLanguage.
  it.each<[string | null, string[], Language[], Language]>([
    // the stored choice wins over the device
    ["en-AU", ["en-US"], ALL, "en-AU"],
    ["en-US", ["en-AU"], ALL, "en-US"],
    // nothing stored: the first offered device language, written either way
    [null, ["en-NZ", "en_US"], ALL, "en-US"],
    // nothing stored, nothing offered that the device speaks: the source
    [null, ["fr", "de-DE"], ALL, "en-AU"],
    [null, [], ALL, "en-AU"],
    // exact only: en-NZ is not en-AU
    [null, ["en-NZ"], ALL, "en-AU"],
  ])(
    "stored %j, device %j, offered %j → %s",
    (stored, device, offered, want) => {
      expect(wantedLanguage(stored, device, offered)).toBe(want);
    },
  );

  // Mutation: pass `ALL` instead of `offered` to matchLanguage in wantedLanguage.
  it("reads a stored language that is no longer offered as absent", () => {
    expect(wantedLanguage("en-XA", ["en-US"], ["en-AU", "en-US"])).toBe(
      "en-US",
    );
    expect(wantedLanguage("en-US", ["en-US"], ["en-AU"])).toBe("en-AU");
    expect(wantedLanguage("garbage", [], ["en-AU"])).toBe("en-AU");
  });
});

describe("languageToStart", () => {
  // Mutation: return `wanted` unconditionally in languageToStart (a client would
  // restart on every start).
  it("is null when the running language is the wanted one", () => {
    expect(languageToStart("en-AU", null, ["en-US"], ["en-AU"])).toBeNull();
    expect(
      languageToStart("en-US", "en-US", [], ["en-AU", "en-US"]),
    ).toBeNull();
  });

  // Mutation: return null in place of `wanted` in languageToStart.
  it("names the wanted language when it differs", () => {
    expect(languageToStart("en-AU", null, ["en-US"], ALL)).toBe("en-US");
    // en-XA stored on a build that no longer offers it
    expect(languageToStart("en-XA", "en-XA", [], ["en-AU"])).toBe("en-AU");
  });
});

describe("languageToRecord", () => {
  // Mutation: compare `running === recorded` in languageToRecord (a client in the
  // source language would write to an account that never recorded one).
  it("writes nothing from the source language to an account with none", () => {
    expect(languageToRecord("en-AU", undefined)).toBeNull();
  });

  // Mutation: return null in languageToRecord's differing case.
  it("writes the running language when the account's differs", () => {
    expect(languageToRecord("en-US", undefined)).toBe("en-US");
    expect(languageToRecord("en-AU", "en-US")).toBe("en-AU");
    expect(languageToRecord("en-US", "en-US")).toBeNull();
  });
});

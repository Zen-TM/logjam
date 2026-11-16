import { afterEach, describe, expect, it, vi } from "vitest";
import type * as dateFormat from "./dateFormat.js";

// US English is the catalogue in `i18nCatalogues/en-US.ts`; Australian English
// is the source and stays the default
// (docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md).
// `i18nCoverage.test.ts` holds that the catalogue is complete and has no stale
// entry; this file holds what a US reader is shown.

const setLanguage = (language: string | undefined) => {
  if (language === undefined)
    delete (globalThis as { LOGJAM_LANGUAGE?: string }).LOGJAM_LANGUAGE;
  else (globalThis as { LOGJAM_LANGUAGE?: string }).LOGJAM_LANGUAGE = language;
};

/** The modules that hold text, loaded as a client that started in `language` loads them: contract text is written at import. */
async function loadIn(language: string | undefined) {
  vi.resetModules();
  setLanguage(language);
  return {
    dates: (await import("./dateFormat.js")) as typeof dateFormat,
    terrain: await import("./contracts/mapTerrain.js"),
    signIn: await import("./signInForm.js"),
    status: await import("./placeStatus.js"),
  };
}

afterEach(() => setLanguage(undefined));

// 15 March 2026 is a Sunday.
const US_FORMS: Record<string, string> = {
  formatWeekdayDayMonthYear: "Sun, Mar 15, 2026",
  formatWeekdayDayMonthYearComma: "Sun, Mar 15, 2026",
  formatWeekdayDayMonth: "Sun, Mar 15",
  formatWeekdayDay: "Sun 15",
  formatDayMonthYear: "Mar 15, 2026",
  formatDayMonth: "Mar 15",
  formatMonthYear: "Mar 2026",
  formatDayLongMonth: "March 15",
  formatDayLongMonthYear: "March 15, 2026",
  formatLongMonthYear: "March 2026",
  formatFullDay: "Sunday, March 15, 2026",
  formatNumericDay: "03/15/2026",
};

describe("US English", () => {
  // Mutation: delete the `<day2>/<month2>/<year>` entry from en-US.ts, or swap
  // the day and the month in the `<day> <month>` one.
  it("writes every day form month first", async () => {
    const { dates } = await loadIn("en-US");
    const forms = Object.entries(dates).filter(([name]) =>
      name.startsWith("format"),
    ) as [string, (day: dateFormat.Day) => string][];
    // Every form has a line here, so a form added later cannot be left out.
    expect(forms.map(([name]) => name).sort()).toEqual(
      Object.keys(US_FORMS).sort(),
    );
    const day = dates.dayOfKey("2026-03-15");
    for (const [name, form] of forms)
      expect(form(day), name).toBe(US_FORMS[name]);
  });

  // Mutation: delete the `Sept: "Sep"` entry from en-US.ts.
  it("writes September as Sep, where Australian English writes Sept", async () => {
    const us = (await loadIn("en-US")).dates;
    expect(us.formatMonthYear({ month: 8, year: 2026 })).toBe("Sep 2026");
    const au = (await loadIn(undefined)).dates;
    expect(au.formatMonthYear({ month: 8, year: 2026 })).toBe("Sept 2026");
  });

  // Mutation: delete the `"Scrub density for bushbashing"` entry, or the
  // `"{0} abseils"` one, or the `"Colour terrain based on how steep it is."` one,
  // from en-US.ts.
  it("uses US words and spellings in the text a screen shows", async () => {
    const { terrain, signIn, status } = await loadIn("en-US");
    expect(terrain.MAP_TERRAIN.copy.vegetationHint).toBe(
      "Scrub density for bushwhacking",
    );
    expect(terrain.MAP_TERRAIN.copy.slopeBandsIntro).toBe(
      "Color terrain based on how steep it is.",
    );
    expect(signIn.signInIntro()).toBe(
      "Your private map and trips for canyoneering in New South Wales.",
    );
    expect(status.placeSummary({ fieldValues: { num_abseils: 3 } })).toBe(
      "3 rappels",
    );
  });

  // Mutation: make `localise` in i18n.ts read the en-US catalogue whatever the language.
  it("leaves Australian English as it was, the default in New South Wales", async () => {
    const { dates, terrain, signIn, status } = await loadIn(undefined);
    expect(terrain.MAP_TERRAIN.copy.vegetationHint).toBe(
      "Scrub density for bushbashing",
    );
    expect(terrain.MAP_TERRAIN.copy.slopeBandsIntro).toBe(
      "Colour terrain based on how steep it is.",
    );
    expect(signIn.signInIntro()).toBe(
      "Your private map and trips for canyoning in New South Wales.",
    );
    expect(status.placeSummary({ fieldValues: { num_abseils: 3 } })).toBe(
      "3 abseils",
    );
    expect(dates.formatDayMonthYear(dates.dayOfKey("2026-03-15"))).toBe(
      "15 Mar 2026",
    );
  });
});

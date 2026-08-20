import { describe, expect, it } from "vitest";

import { rankLocalMatches } from "./localSearch";

const items = [
  { title: "Claustral Canyon", alternates: ["Clausy"], value: "claustral" },
  { title: "Ranon Brook", value: "ranon" },
  { title: "Bell Creek Canyon", value: "bell" },
  { title: "Car park", alternates: ["parking", "clausy start"], value: "carpark" },
];

describe("rankLocalMatches", () => {
  it("puts a title that starts with the query above one that merely contains it", () => {
    expect(rankLocalMatches("can", items, 10).map((m) => m.value)).toEqual([
      "claustral",
      "bell",
    ]);
  });

  it("matches alternates, but ranks them below any title match", () => {
    expect(rankLocalMatches("clausy", items, 10).map((m) => m.value)).toEqual([
      "claustral",
      "carpark",
    ]);
  });

  it("is case-insensitive and ignores surrounding space", () => {
    expect(rankLocalMatches("  BELL ", items, 10).map((m) => m.value)).toEqual(["bell"]);
  });

  it("answers nothing below the minimum length, so one keystroke isn't a list", () => {
    expect(rankLocalMatches("c", items, 10)).toEqual([]);
    expect(rankLocalMatches("", items, 10)).toEqual([]);
  });

  it("keeps the caller's order inside one rank, and honours the cap", () => {
    // Both are contains-matches, so the composition order decides.
    expect(rankLocalMatches("an", items, 2).map((m) => m.value)).toEqual([
      "claustral",
      "ranon",
    ]);
  });
});

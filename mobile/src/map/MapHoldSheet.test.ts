// The hold sheet's rows come from the contract, read as text: the screens have
// no render test.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mapHoldVerbs, mapPointVerbs } from "@logjam/shared";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");

describe("the press-and-hold sheet", () => {
  // Mutation: write a verb's label back into `MapScreen.tsx` as a literal, or
  // draw a list other than `mapHoldVerbs("gps")` in the sheet.
  it("draws its rows from the contract and keeps no verb words of its own", () => {
    expect(read("MapHoldSheet.tsx")).toContain('mapHoldVerbs("gps")');
    const screen = read("MapScreen.tsx");
    for (const verb of [...mapHoldVerbs("gps"), ...mapPointVerbs("gps")])
      expect(screen, verb.label).not.toContain(`"${verb.label}"`);
  });
});

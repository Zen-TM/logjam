// Both clients draw a place's page in the order `PLACE_PAGE` declares, and
// nothing else decides it: each walks `contractSectionsFor` and calls the
// section for every key, so a page that placed one section by hand (a
// `sections.weather()` outside the walk) would drift from the other client.
//
// Mutation that turns it red: call `sections.weather()` from the JSX of either
// page, or replace its `contractSectionsFor(PLACE_PAGE, …)` walk with a
// hand-written list of keys.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PLACE_PAGE } from "./placePage.js";

const repo = join(import.meta.dirname, "..", "..", "..");
const pages = {
  web: "frontend/src/components/sidebar/panels/PlaceDetailPanel.tsx",
  gps: "mobile/src/places/PlaceDetailScreen.tsx",
} as const;

describe.each(Object.entries(pages))(
  "Logjam %s's place page",
  (client, file) => {
    const source = readFileSync(join(repo, file), "utf8");

    it("walks the contract's sections", () => {
      expect(source).toContain(`contractSectionsFor(PLACE_PAGE, "${client}"`);
    });

    it("draws a section only inside that walk (the hero aside, on GPS)", () => {
      const direct = [...source.matchAll(/sections\.(\w+)\(\)/g)].map(
        (m) => m[1],
      );
      expect(direct).toEqual(client === "gps" ? ["hero"] : []);
    });

    it("names every key the contract does for its client", () => {
      for (const { key } of PLACE_PAGE.sections)
        expect(source).toMatch(new RegExp(`\\b${key}: \\(`));
    });
  },
);

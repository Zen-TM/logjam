import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLACE_PAGE } from "@logjam/shared";

// The owner's place page says, in each section's title, that a friend sees it
// (`shareeSees` on PLACE_PAGE). Both clients draw the title, so each must pass
// every flagged section through `placeSectionTitle`. Mutations that turn it
// red: draw `copy.photos` bare in the page, or flag a section on the contract
// that the page doesn't mark.
const PAGE = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "components/sidebar/panels/PlaceDetailPanel.tsx",
  ),
  "utf8",
);

describe("the owner's place page on Logjam Web", () => {
  it("marks every section a friend sees", () => {
    const flagged = PLACE_PAGE.sections.filter(
      (section) => "shareeSees" in section,
    );
    expect(flagged.length).toBeGreaterThan(0);
    const unmarked = flagged
      .map((section) => section.key)
      .filter(
        (key) => !new RegExp(`placeSectionTitle\\(\\s*"${key}"`).test(PAGE),
      );
    expect(unmarked).toEqual([]);
  });
});

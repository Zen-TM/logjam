import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Mutation: put a `<Button` (or `CardActions`) back in the row's footer and
// the place page draws a button card between its Coordinates and Open in maps
// cards instead of a card row like theirs.
describe("MapCoverageRow", () => {
  it("is a pressable card row, not a card holding a button", () => {
    const source = readFileSync(
      new URL("./MapCoverageRow.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/<Button|CardActions/);
    expect(source).toMatch(/title="Save an offline map"/);
    expect(source).toMatch(/disabled=\{!online\}/);
  });
});

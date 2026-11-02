import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A latitude or longitude field routes what it is given through
// `coordinateEntry` (shared/src/coordinates.ts), so a pasted "lat, lng" pair
// fills both fields instead of one field keeping, or joining, the lot.
//
// Mutation that turns it red: add a field labelled Latitude, or one that
// reads `itemLatitude`, in a component that does not use `coordinateEntry`
// (or the NumberField `coordinate` prop).
const SRC = dirname(fileURLToPath(import.meta.url));
const FIELD = /label="Latitude"|label=\{copy\.itemLatitude\}/;

describe("coordinate fields", () => {
  it("all take a pasted pair", () => {
    const fields = readdirSync(SRC, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
      .map((f) => ({ f, text: readFileSync(join(SRC, f), "utf8") }))
      .filter(({ text }) => FIELD.test(text));
    // Not vacuous: the scan finds the fields it guards.
    expect(fields.length).toBeGreaterThan(1);
    const bare = fields
      .filter(({ text }) => !/coordinateEntry|coordinate=\{/.test(text))
      .map(({ f }) => f);
    expect(bare).toEqual([]);
  });
});

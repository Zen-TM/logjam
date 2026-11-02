import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A latitude or longitude field routes what it is given through
// `coordinateEntry` (shared/src/coordinates.ts), so a pasted "lat, lng" pair
// fills both fields instead of one field keeping, or joining, the lot.
//
// Mutation that turns it red: in any of these forms, drop `coordinateEntry`
// (or the NumberField `coordinate` prop) from the Longitude field alone, or
// add a Latitude or Longitude field that does not use it.
const SRC = dirname(fileURLToPath(import.meta.url));
const FIELD =
  /label="(Latitude|Longitude)"|label=\{copy\.item(Latitude|Longitude)\}/;
// With the whitespace gone, so a call a formatter wrapped still reads.
const routed = (text: string, axis: string) =>
  new RegExp(`coordinateEntry\\([^)]*"${axis}"|axis:"${axis}"`).test(
    text.replace(/\s+/g, ""),
  );

describe("coordinate fields", () => {
  it("all take a pasted pair", () => {
    const fields = readdirSync(SRC, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
      .map((f) => ({ f, text: readFileSync(join(SRC, f), "utf8") }))
      .filter(({ text }) => FIELD.test(text));
    // Not vacuous: the scan finds the fields it guards.
    expect(fields.length).toBeGreaterThan(1);
    const bare = fields.flatMap(({ f, text }) =>
      ["latitude", "longitude"]
        .filter((axis) => !routed(text, axis))
        .map((axis) => `${f}: ${axis}`),
    );
    expect(bare).toEqual([]);
  });
});

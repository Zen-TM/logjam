import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Logjam GPS's tray is the shared declaration, drawn with its words.
// Mutation: hand-write the tool list or a label in `MapToolGroup.tsx`, or draw
// the glyph alone (drop the `tool.label` Text), and this goes red.
describe("MapToolGroup", () => {
  const source = readFileSync(
    new URL("./MapToolGroup.tsx", import.meta.url),
    "utf8",
  );
  it("holds exactly the tools MAP_TOOLS gives Logjam GPS", () => {
    expect(source).toContain('export const TOOLS = mapTools("gps");');
  });
  it("shows each tool's label, not a glyph alone", () => {
    expect(source).toContain("{tool.label}");
  });
});

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
  it("shows each tool's description under it", () => {
    expect(source).toContain("{tool.description}");
  });
  it("moves with native-driver timings that reduced motion zeroes", () => {
    expect(source).toContain("useNativeDriver: true");
    expect(source).toContain("reduceMotion ? 0");
  });
});

// Mutation: drop the backdrop Pressable from MapScreen, or let its onPress do
// more than close the tray, and a press that closes the tray also reaches the
// map or a button under it.
describe("MapScreen's tools backdrop", () => {
  const source = readFileSync(
    new URL("./MapScreen.tsx", import.meta.url),
    "utf8",
  );
  it("closes the open tray and nothing else", () => {
    expect(source).toMatch(
      /\{toolsOpen \? \(\s*<Pressable\s+style=\{StyleSheet\.absoluteFill\}\s+accessible=\{false\}\s+onPress=\{\(\) => setToolsOpen\(false\)\}\s*\/>/,
    );
  });
});

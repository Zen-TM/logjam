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

// Mutation: drop the backdrop Pressable (a press on the map then also reaches
// the map), drop `onTouchEnd={closeToolsAfterOutsideTouch}` (a press elsewhere
// leaves the tray open), or move the backdrop over the controls (a tab or a map
// button then stops acting).
describe("MapScreen's tools tray and an outside press", () => {
  const source = readFileSync(
    new URL("./MapScreen.tsx", import.meta.url),
    "utf8",
  );
  it("catches a press on the map only, under every control", () => {
    expect(source).toMatch(
      /<\/Map>\s*\{\/\*[\s\S]*?\*\/\}\s*\{toolsOpen \? \(\s*<Pressable\s+style=\{StyleSheet\.absoluteFill\}\s+accessible=\{false\}\s+onPress=\{\(\) => \{\}\}\s*\/>/,
    );
  });
  it("closes on any touch that did not start on the + or the tray", () => {
    expect(source).toContain("onTouchEnd={closeToolsAfterOutsideTouch}");
    expect(source).toContain("<View onTouchStart={markToolsTouch}>");
    expect(source).toContain("onTouchStart={markToolsTouch}");
  });
});

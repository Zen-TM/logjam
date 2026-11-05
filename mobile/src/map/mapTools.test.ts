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
  // Mutation: draw a second line under the label.
  it("shows no description line under a tool", () => {
    expect(source).not.toContain("description");
  });
  it("moves with native-driver timings that reduced motion zeroes", () => {
    expect(source).toContain("useNativeDriver: true");
    // Mutation: drop `reduceMotion` from the duration OR from the delay (the
    // stagger then still waits). Only an early open, before
    // `useReduceMotion` has read the setting, can still animate.
    expect(source).toMatch(/duration: reduceMotion \? 0 :/);
    expect(source).toMatch(/delay: reduceMotion \|\|/);
  });
});

// Mutation: drop `onTouchStart={handleRootTouchStart}`, the focus effect, or
// the `ignoreMapPress` line in one of the press handlers; or put a backdrop back
// over the map (a pan with the tray open is then swallowed whole). The decision
// itself is `toolsTouch.test.ts`.
describe("MapScreen's tools tray and a touch outside it", () => {
  const source = readFileSync(
    new URL("./MapScreen.tsx", import.meta.url),
    "utf8",
  );
  it("closes on a touch start, and shuts when the map loses focus", () => {
    expect(source).toContain("onTouchStart={handleRootTouchStart}");
    expect(source).toContain("<View onTouchStart={markToolsTouch}>");
    expect(source).toContain("onTouchStart={markToolsTouch}");
    expect(source).toContain(
      "useFocusEffect(useCallback(() => () => setToolsOpen(false), []));",
    );
  });
  it("ignores the press and long-press that started with the tray open", () => {
    const handlers = [
      "const handleMapPress = useCallback(",
      "const handleMapLongPress = useCallback(",
      "const handlePlacePress = useCallback(",
      "const handleGaugePress = useCallback(",
      "const handleImportPress = useCallback(",
      "const pressRoute = useCallback(",
    ];
    for (const handler of handlers) {
      const at = source.indexOf(handler);
      expect(at, handler).toBeGreaterThan(-1);
      expect(source.slice(at, at + 400), handler).toContain(
        "if (ignoreMapPress.current) return;",
      );
    }
  });
  it("has no backdrop over the map", () => {
    expect(source).not.toContain("StyleSheet.absoluteFill");
  });
});

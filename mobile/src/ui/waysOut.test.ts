import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("..", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

// Anything that opens OVER something else has a visible ×; a pushed page has a
// back arrow; a root tab has neither (shared/DESIGN.md §3).
describe("ways out", () => {
  // Red when `BottomSheet` loses its ×: every sheet in the app would then have
  // only a gesture. To see it: delete the `icon="close"` line in BottomSheet.tsx.
  it("every sheet draws a visible ×", () => {
    const sheet = readFileSync(
      new URL("./BottomSheet.tsx", import.meta.url),
      "utf8",
    );
    expect(sheet).toMatch(/icon="close"[\s\S]{0,80}accessibilityLabel="Close"/);
  });

  // Red when a new `<Modal` appears: each one must be reviewed for a ×, then
  // added here. The three below draw one.
  it("names every modal, so a new one is reviewed for its ×", () => {
    const modals = sources(SRC)
      .filter((path) => /<Modal\b/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path))
      .sort();
    expect(modals).toEqual([
      "media/MediaViewer.tsx",
      "ui/BottomSheet.tsx",
      "ui/ColourField.tsx",
    ]);
  });

  // The two pickers pushed over the map have no hero to hold a back arrow.
  it("the pushed map pickers draw a back arrow", () => {
    for (const file of ["map/PickPointScreen.tsx", "map/PickAreaScreen.tsx"])
      expect(readFileSync(join(SRC, file), "utf8"), file).toContain(
        "<MapBackButton",
      );
  });
});

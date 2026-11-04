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

// A colour is chosen from a floating palette opened from a swatch, never an
// inline row of swatches: `ColourField` is the one place a palette is drawn.
// Red when a screen maps a palette to pressables itself. To see it: add
// `{TRACK_COLORS.map((c) => <Pressable key={c} />)}` to any screen.
describe("a palette", () => {
  it("is drawn only by the kit's ColourField", () => {
    const inline = sources(SRC)
      .filter((path) => !path.endsWith("ui/ColourField.tsx"))
      .filter((path) =>
        /(TRACK_COLORS|PLACE_TYPE_COLORS|MARKER_COLOR_ORDER)\s*\.map\(/.test(
          readFileSync(path, "utf8"),
        ),
      )
      .map((path) => relative(SRC, path));
    // The marker palette is mapped to hex values for the picker, not drawn.
    expect(inline).toEqual(["screens/settings/MapSettingsScreen.tsx"]);
  });
});

// An options sheet and Settings > Map are stacks of card rows, so their colour
// is one too; only the route toolbar's bare disc (`hideLabel`) is not. Mutation:
// drop `icon="colour"` from the colour in TrackOptionsSheet, ImportOptionsSheet
// or MapSettingsScreen, and it is a bare row between cards again.
describe("a colour in a stack of card rows", () => {
  it.each([
    "screens/settings/MapSettingsScreen.tsx",
    "tracks/TrackOptionsSheet.tsx",
    "imports/ImportOptionsSheet.tsx",
  ])("is drawn as a settings row in %s", (file) => {
    expect(readFileSync(join(SRC, file), "utf8")).toMatch(
      /<ColourField\s+icon="colour"/,
    );
  });
});

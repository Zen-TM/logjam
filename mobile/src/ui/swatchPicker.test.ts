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
// inline row of swatches: `SwatchPicker` is the one place a palette is drawn.
// Red when a screen maps a palette to pressables itself. To see it: add
// `{TRACK_COLORS.map((c) => <Pressable key={c} />)}` to any screen.
describe("a palette", () => {
  it("is drawn only by the kit's SwatchPicker", () => {
    const inline = sources(SRC)
      .filter((path) => !path.endsWith("ui/SwatchPicker.tsx"))
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

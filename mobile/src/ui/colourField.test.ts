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

// A colour among card rows is a card row too (`icon="colour"`), so a new options
// sheet or settings page cannot bring back a bare label-and-disc between cards.
// The only bare ones are listed here, each with why. Mutation: add
// `<ColourField label="Colour" ... />` to any screen, or drop `icon="colour"`
// from TrackOptionsSheet, ImportOptionsSheet or MapSettingsScreen.
const BARE_COLOUR_FIELDS: Record<string, string> = {
  "map/DraftToolPanel.tsx": "the route toolbar's disc, among icon buttons",
  "places/PlaceTypesEditor.tsx": "a field in a form, among fields not cards",
};

describe("a colour in a stack of card rows", () => {
  it("is a settings row everywhere but where listed", () => {
    const bare = sources(SRC)
      .flatMap((path) => {
        const text = readFileSync(path, "utf8");
        const count = [...text.matchAll(/<ColourField(?!\s+icon="colour")/g)]
          .length;
        return count ? [[relative(SRC, path), count] as const] : [];
      })
      .filter(([path]) => !path.endsWith("ui/ColourField.tsx"));
    expect(Object.fromEntries(bare)).toEqual(
      Object.fromEntries(Object.keys(BARE_COLOUR_FIELDS).map((p) => [p, 1])),
    );
  });
});

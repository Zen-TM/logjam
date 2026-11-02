import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { barrelComponents, kitComponentsFor } from "@logjam/shared";

// The barrel exports EXACTLY the kit's declared components for this client
// (`KIT_COMPONENTS` in shared/src/kit.ts: `both` plus `gps`). A component is a
// PascalCase value export; a helper (`useBulkSelection`, `toDateKey`,
// `CHIP_RAIL_HEIGHT`) is not, and a type is not a value.
//
// Mutations that turn it red: export a new component from index.ts without
// declaring it; delete a declared one's export line; rename one in the barrel
// (`Hero` back to `HeroHeader`).
// Mutation: drop `style={styles.content}`, and rows stacked in a sheet touch.
describe("BottomSheet", () => {
  it("spaces what it stacks", () => {
    const sheet = readFileSync(
      new URL("./BottomSheet.tsx", import.meta.url),
      "utf8",
    );
    expect(sheet).toContain("style={styles.content}");
    expect(sheet).toMatch(/content: \{ gap: spacing\(1\) \}/);
  });
});

describe("the Logjam GPS kit barrel", () => {
  it("exports exactly the declared components", () => {
    const barrel = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(barrelComponents(barrel)).toEqual(kitComponentsFor("gps"));
  });
});

// A kit container that takes `children` and can stack more than one owns the
// gap between them (shared/DESIGN.md §10), so a screen never has to space what
// it puts inside. Mutation: delete `gap` from one style below (`ListEnd`'s
// `end`, say) and two buttons in it touch.
describe("kit containers that stack children", () => {
  const stacks: [file: string, style: string][] = [
    ["ListEnd.tsx", "end"],
    ["Field.tsx", "field"],
    ["Field.tsx", "stack"],
    ["Screen.tsx", "scrollContent"],
    ["Hero.tsx", "hero"],
    ["BottomSheet.tsx", "content"],
  ];
  it.each(stacks)("%s sets a gap on %s", (file, style) => {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    expect(src).toMatch(new RegExp(`\\b${style}: \\{[^}]*\\bgap:`));
  });
});

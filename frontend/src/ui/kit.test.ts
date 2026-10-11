import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { barrelComponents, kitComponentsFor } from "@logjam/shared";

// The barrel exports EXACTLY the kit's declared components for this client
// (`KIT_COMPONENTS` in shared/src/kit.ts: `both` plus `web`). A component is a
// PascalCase value export; a helper (`useEscape`) is not, and a type is not a
// value.
//
// Mutations that turn it red: export a new component from index.ts without
// declaring it; delete a declared one's export line; rename one in the barrel
// (`Hero` to `Banner`).
describe("the Logjam Web kit barrel", () => {
  it("exports exactly the declared components", () => {
    const barrel = readFileSync(join(__dirname, "index.ts"), "utf8");
    expect(barrelComponents(barrel)).toEqual(kitComponentsFor("web"));
  });
});

// UX §10: a colour is chosen from a floating palette, never an inline row of
// swatches, and there is ONE component that draws it. Red when a screen brings
// back a second picker (a `SwatchPicker`, or a native `<input type="color">`).
describe("the one colour picker", () => {
  it("has no second picker in the barrel or the screens", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(__dirname, "..");
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) {
          // Code only: a comment may name what it replaced.
          sources.push(
            readFileSync(path, "utf8")
              .split("\n")
              .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
              .join("\n"),
          );
        }
      }
    };
    walk(root);
    const all = sources.join("\n");
    expect(/<SwatchPicker|type="color"/.test(all)).toBe(false);
  });
});

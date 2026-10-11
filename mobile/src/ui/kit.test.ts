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
describe("the Logjam GPS kit barrel", () => {
  it("exports exactly the declared components", () => {
    const barrel = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(barrelComponents(barrel)).toEqual(kitComponentsFor("gps"));
  });
});

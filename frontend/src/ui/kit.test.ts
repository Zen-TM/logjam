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

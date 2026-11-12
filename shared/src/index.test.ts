// The barrel is what Logjam Web bundles, so nothing it reaches may load
// pdf-lib (shared/src/geoPdfImport/parseGeoref.ts says why).
import { expect, it, vi } from "vitest";

vi.mock("@cantoo/pdf-lib", () => {
  throw new Error("the shared barrel reached @cantoo/pdf-lib");
});

// Mutation: export anything from ./geoPdfImport in src/index.ts.
it("never loads pdf-lib", async () => {
  await expect(import("./index")).resolves.toBeDefined();
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  delete (globalThis as Record<string, unknown>).LOGJAM_SIM_REGIONS;
});

// The render worker has its own global scope, so the printed grid and the
// compass read `REGIONS` there, not the page's. The worker's first import is
// the one that sets the simulated-regions switch again, before anything loads
// `@logjam/shared`.
describe("the render worker's regions", () => {
  const imports = readFileSync(join(import.meta.dirname, "worker.ts"), "utf8")
    .split("\n")
    .filter((line) => line.startsWith("import "));

  // Mutation: move the `../simRegions` import below `./render` in worker.ts,
  // or drop it.
  it("sets the simulated-regions switch before anything that loads @logjam/shared", () => {
    expect(imports.length).toBeGreaterThanOrEqual(3);
    expect(imports[0]).toBe('import "../simRegions";');
  });

  // Mutation: have `sheetGrid` read no default regions (pass `[]` for them),
  // and a sheet over Wanaka is UTM, as it printed in the worker before.
  it("gives a sheet over simulated Wanaka NZTM with the default regions", async () => {
    vi.stubEnv("VITE_SIM_REGIONS", "1");
    vi.stubEnv("VITE_AUTH_MODE", "fake");
    vi.resetModules();
    await import("../simRegions");
    const { sheetGrid } = await import("./sheetGrid");
    const wanaka = { north: -44.6, south: -44.7, east: 169.2, west: 169.1 };
    expect(sheetGrid(wanaka).zone.name).toBe("NZTM");
  });
});

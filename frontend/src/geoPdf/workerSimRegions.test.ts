import { afterEach, beforeEach, expect, it, vi } from "vitest";

// A worker has its own global scope, so the simulated-regions switch the page
// set does not reach it, and `@logjam/shared` reads the switch once, when it
// loads. Each GeoPDF worker entry loads the real module (the worker's `self` is
// this file's window) and then asks shared which regions it knows.
// Mutation that turns it red: move `import "../simRegions"` below the import of
// `./render` in worker.ts, or below the import of `./prefetch` in
// prefetch.worker.ts (each row names its own).
beforeEach(() => {
  vi.resetModules();
  delete (globalThis as { LOGJAM_SIM_REGIONS?: boolean }).LOGJAM_SIM_REGIONS;
  vi.stubEnv("VITE_SIM_REGIONS", "1");
  vi.stubEnv("VITE_AUTH_MODE", "fake");
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as { LOGJAM_SIM_REGIONS?: boolean }).LOGJAM_SIM_REGIONS;
});

it.each(["./worker", "./prefetch.worker"])(
  "%s sets the switch before shared loads",
  async (entry) => {
    await import(/* @vite-ignore */ entry);
    const { REGIONS } = await import("@logjam/shared");
    expect(REGIONS.map((r) => r.id)).toEqual(["nsw", "simnz", "simutah"]);
  },
  60_000,
);

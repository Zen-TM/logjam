import { expect, it, vi } from "vitest";

// Map.tsx imports a Vite virtual module that vitest cannot resolve; the rest of
// App still reaches shared.
vi.mock("./components/map/Map", () => ({ default: () => null }));

// shared reads the simulated-regions switch when it loads, so main.tsx's first
// import must set it. This loads the real entry and then asks shared. A
// switch that shared loaded before reads off, and this test fails.
// Mutation that turns it red: move `import "./simRegions"` below `import App`
// in main.tsx. Kept to one test in its own file: a module loaded earlier in a
// file would be loaded already.
it("main.tsx sets the switch before shared loads", async () => {
  vi.stubEnv("VITE_SIM_REGIONS", "1");
  vi.stubEnv("VITE_AUTH_MODE", "fake");
  await import("./main");
  const { REGIONS } = await import("@logjam/shared");
  expect(REGIONS.map((r) => r.id)).toEqual(["nsw", "simnz", "simutah"]);
}, 60_000);

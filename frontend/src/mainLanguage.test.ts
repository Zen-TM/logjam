import { afterEach, expect, it, vi } from "vitest";

// Map.tsx imports a Vite virtual module that vitest cannot resolve; the rest of
// App still reaches shared.
vi.mock("./components/map/Map", () => ({ default: () => null }));

afterEach(() => {
  localStorage.clear();
  delete (globalThis as { LOGJAM_LANGUAGE?: string }).LOGJAM_LANGUAGE;
});

// Contract text is evaluated when shared loads, so main.tsx's imports must set
// the language before anything reaches it. This loads the real entry and then
// asks shared for text. Mutation that turns it red: move `import "./language"`
// below `import App` in main.tsx. Kept to one test in its own file: a module
// loaded earlier in a file would be loaded already.
it("main.tsx sets the language before shared loads", async () => {
  localStorage.setItem("logjam.language", "en-XA");
  await import("./main");
  const { LANGUAGE_SETTING } = await import("@logjam/shared");
  expect(LANGUAGE_SETTING.title).toMatch(/^⟦.*⟧$/);
}, 60_000);

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.doUnmock("./render");
  vi.doUnmock("./cache");
});

// The render worker has its own global scope, so the page's display units are
// not there: the printed scale bar would always be metric. Each request carries
// them and the worker sets them before it renders.
describe("the render worker's display units", () => {
  // Mutation: drop `setDisplayUnits(units)` from the worker's `onmessage`, and
  // a render of an imperial page draws in metric.
  it("sets the request's units before it renders", async () => {
    vi.resetModules();
    const scope = {
      postMessage: vi.fn(),
      onmessage: null as null | ((e: { data: unknown }) => Promise<void>),
    };
    vi.stubGlobal("self", scope);
    const seen: string[] = [];
    // The same module registry as the worker's, so it is the worker's units.
    const { displayUnits } = await import("@logjam/shared");
    vi.doMock("./cache", () => ({ tileCache: () => ({}) }));
    vi.doMock("./render", () => ({
      TooLarge: class extends Error {},
      renderGeoPdf: async () => {
        seen.push(displayUnits());
        throw new Error("stop here");
      },
    }));
    await import("./worker");
    for (const units of ["imperial", "metric"])
      await scope.onmessage!({
        data: { type: "render", input: {}, limits: null, units },
      });
    expect(seen).toEqual(["imperial", "metric"]);
    expect(scope.postMessage).toHaveBeenCalledWith({ type: "failed" });
  });
});

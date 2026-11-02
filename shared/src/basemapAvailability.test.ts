import { describe, expect, it } from "vitest";
import {
  basemapToShow,
  isServerFault,
  withBasemapDown,
} from "./basemapAvailability.js";

describe("basemap availability", () => {
  // Mutation: count 404 as a fault, and every tile outside a provider's
  // coverage marks a healthy server down.
  it("a missing tile is not an outage; a dead or erroring server is", () => {
    expect(isServerFault(404)).toBe(false);
    expect(isServerFault(403)).toBe(false);
    expect(isServerFault(503)).toBe(true);
    expect(isServerFault(0)).toBe(true);
    expect(isServerFault(undefined)).toBe(true);
  });

  // Mutation: return a fresh Set on a no-op and every tile load re-renders.
  it("returns the same set when nothing changes", () => {
    const down = new Set(["a"]);
    expect(withBasemapDown(down, "a", true)).toBe(down);
    expect(withBasemapDown(down, "b", false)).toBe(down);
    expect([...withBasemapDown(down, "b", true)]).toEqual(["a", "b"]);
    expect([...withBasemapDown(down, "a", false)]).toEqual([]);
  });

  // Mutation: fall back when the fallback is down too, and the map shows a
  // second dead basemap instead of the pick.
  it("falls back only to a basemap that is up", () => {
    expect(basemapToShow("x", new Set(["x"]), "d")).toBe("d");
    expect(basemapToShow("x", new Set(), "d")).toBe("x");
    expect(basemapToShow("x", new Set(["x", "d"]), "d")).toBe("x");
    expect(basemapToShow("d", new Set(["d"]), "d")).toBe("d");
  });
});

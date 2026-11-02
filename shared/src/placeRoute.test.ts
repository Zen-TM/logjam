import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { placeRoute } from "./placeRoute.js";

const drawn = (id: string, placeId: string | null) => ({ id, placeId });
const file = (id: string, mediaType: string) => ({ id, mediaType });

describe("placeRoute", () => {
  it("is the drawn route linked to the place", () => {
    const hit = drawn("r2", "p1");
    expect(placeRoute("p1", [drawn("r1", "p2"), hit], [])).toEqual({
      kind: "drawn",
      route: hit,
    });
  });

  it("is the attached track file when nothing is drawn", () => {
    const gpx = file("m2", "application/gpx+xml");
    expect(
      placeRoute("p1", [drawn("r1", null)], [file("m1", "image/jpeg"), gpx]),
    ).toEqual({ kind: "file", file: gpx });
  });

  it("prefers the drawn route, as the slot is taken", () => {
    const got = placeRoute(
      "p1",
      [drawn("r1", "p1")],
      [file("m1", "application/gpx+xml")],
    );
    expect(got?.kind).toBe("drawn");
  });

  it("is null with neither", () => {
    expect(
      placeRoute("p1", [drawn("r1", "p2")], [file("m1", "image/png")]),
    ).toBeNull();
  });
});

// Parity (ADR 0020): both place pages decide through placeRoute. Mutation that
// turns it red: put a client back on its own `routes.find(... placeId ...)`.
describe("both clients use placeRoute", () => {
  const repo = join(import.meta.dirname, "..", "..");
  it.each([
    "frontend/src/components/sidebar/panels/PlaceDetailPanel.tsx",
    "mobile/src/places/PlaceDetailScreen.tsx",
  ])("%s", (path) => {
    expect(readFileSync(join(repo, path), "utf8")).toContain("placeRoute(");
  });
});

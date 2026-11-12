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

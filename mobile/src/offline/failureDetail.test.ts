// The failure message a download row now shows is text that came from an
// exception, so it goes on screen and into a screenshot. These assert the two
// things that matter: it says something useful, and it cannot carry an area.
import { describe, expect, it } from "vitest";

import { failureDetail } from "./failureDetail";

describe("failureDetail", () => {
  it("keeps a plain message", () => {
    expect(failureDetail(new Error("database is locked"))).toBe(
      "database is locked",
    );
  });

  it("drops anything URL- or path-shaped", () => {
    // A tile URL carries z/x/y, which IS the region of interest.
    expect(
      failureDetail(
        new Error("fetch failed https://maps.six.nsw.gov.au/tile/16/60123/39456"),
      ),
    ).toBe("fetch failed");
    expect(
      failureDetail(new Error("cannot open file:///data/user/0/regions/a.mbtiles")),
    ).toBe("cannot open");
    expect(failureDetail(new Error("/data/user/0/x.mbtiles"))).toBeUndefined();
  });

  it("caps the length", () => {
    expect(failureDetail(new Error("x".repeat(500)))).toHaveLength(120);
  });

  it("has nothing to say about a non-error", () => {
    expect(failureDetail(undefined)).toBeUndefined();
    expect(failureDetail({})).toBeUndefined();
    expect(failureDetail(new Error("   "))).toBeUndefined();
  });
});

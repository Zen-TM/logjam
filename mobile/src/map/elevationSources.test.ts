import { describe, expect, it } from "vitest";

import { planElevationSources } from "./elevationSources";

// The saved tiles on the device are ALWAYS read and are not in this plan —
// this only decides what may leave the phone.
describe("planElevationSources", () => {
  it("uses our API for a signed-in user, with the public tiles behind it", () => {
    // API first is a privacy decision: the server fetches the DEM on its own
    // connection, so the tile indices tracing the drawn line stay off the
    // user's. The tiles remain as the fallback for an API that 404s.
    expect(planElevationSources({ allowNetwork: true, isGuest: false })).toEqual({
      api: true,
      tiles: true,
    });
  });

  it("gives a guest the public tiles, since they cannot authenticate", () => {
    expect(planElevationSources({ allowNetwork: true, isGuest: true })).toEqual({
      api: false,
      tiles: true,
    });
  });

  it("makes no request at all in offline-only mode", () => {
    // "Simulating offline mode" has to mean it. Saved regions still answer —
    // that is the whole point of the mode — but nothing goes out.
    expect(planElevationSources({ allowNetwork: false, isGuest: false })).toEqual({
      api: false,
      tiles: false,
    });
  });

  it("still makes no request for a guest in offline-only mode", () => {
    // The combination worth its own case: two reasons to skip the API and one
    // to skip the tiles, and an || in the wrong place leaks the tile fetch.
    expect(planElevationSources({ allowNetwork: false, isGuest: true })).toEqual({
      api: false,
      tiles: false,
    });
  });
});

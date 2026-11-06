import { describe, expect, it } from "vitest";

import { navFigures } from "./navFigures";

const NOW = 1_700_000_000_000;

// Mutations that turn it red: show a fresh-looking figure for a stale fix
// (`grey: false`), or drop the "about" for a coarse one.
describe("navFigures", () => {
  it("shows a live fix plainly", () => {
    expect(navFigures(224, 356, "live", NOW - 1000, NOW)).toEqual({
      known: true,
      distance: "224",
      unit: " m",
      bearing: "N 356°",
      about: false,
      grey: false,
      age: null,
    });
  });

  it("greys a stale fix and says how old it is", () => {
    const stale = navFigures(224, 356, "stale", NOW - 125_000, NOW);
    expect(stale.grey).toBe(true);
    expect(stale.age).toBe("2 min ago");
  });

  it("says about for a coarse fix", () => {
    expect(navFigures(224, 356, "coarse", NOW - 1000, NOW).about).toBe(true);
  });

  it("is a dash before the first fix", () => {
    expect(navFigures(null, null, "stale", null, NOW)).toMatchObject({
      known: false,
      distance: "—",
      bearing: "—",
      about: false,
      age: null,
    });
  });
});

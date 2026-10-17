import { describe, expect, it } from "vitest";
import {
  drainage,
  OUTLET,
  pickArea,
  sunPosition,
  traceDownhill,
  valleyLight,
} from "./signInTerrain";

const DEG = 180 / Math.PI;

describe("sunPosition", () => {
  // Published for Sydney, 21 Dec 2026: solar noon about 12:57 AEDT at 79.5°;
  // sunrise 05:41 at an azimuth of about 119°. Near a summer noon the azimuth
  // swings a degree a minute, so it is only held to "north". Mutation that
  // turns it red: drop `lon` from the hour angle.
  it("puts the summer noon sun high in the north", () => {
    const sun = sunPosition(new Date("2026-12-21T01:57:00Z"), -33.87, 151.21);
    expect(sun.altitude * DEG).toBeCloseTo(79.5, 0);
    expect(Math.min(sun.azimuth * DEG, 360 - sun.azimuth * DEG)).toBeLessThan(
      15,
    );
  });

  it("rises in the south of east at midsummer", () => {
    const sun = sunPosition(new Date("2026-12-20T18:41:00Z"), -33.87, 151.21);
    expect(Math.abs(sun.altitude * DEG)).toBeLessThan(1);
    expect(sun.azimuth * DEG).toBeCloseTo(119, -1);
  });
});

describe("valleyLight", () => {
  it("lights from the north at noon and from the north-west at night", () => {
    const noon = valleyLight(new Date("2026-06-21T02:00:00Z"), -33.6, 150.3);
    expect(noon.light[1]).toBeLessThan(0); // y is south: negative is north
    const night = valleyLight(new Date("2026-06-21T14:00:00Z"), -33.6, 150.3);
    expect(night.light[0]).toBeLessThan(0);
    expect(night.light[1]).toBeLessThan(0);
    expect(night.gain).toBeLessThan(noon.gain);
  });

  it("is a unit vector", () => {
    const { light } = valleyLight(
      new Date("2026-03-01T22:00:00Z"),
      -33.6,
      150.3,
    );
    expect(Math.hypot(...light)).toBeCloseTo(1, 6);
  });
});

describe("drainage and traceDownhill", () => {
  // 3×2, everything ends at the top right:  → → out
  //                                          ↗ → ↑
  const E = 2;
  const N = 0;
  const NE = 1;
  const dir = Uint8Array.from([E, E, OUTLET, NE, E, N]);

  it("counts every upstream cell", () => {
    expect(Array.from(drainage(dir, 3, 2))).toEqual([1, 3, 6, 1, 1, 2]);
  });

  it("follows the arrows to the outlet", () => {
    expect(traceDownhill(dir, 3, 2, 0, 1)).toEqual([3, 1, 2]);
  });
});

describe("pickArea", () => {
  // Mutation that turns it red: drop the filter on `last`.
  it("never repeats the last area", () => {
    for (const random of [0, 0.3, 0.6, 0.99])
      expect(pickArea(["a", "b", "c"], "b", random)).not.toBe("b");
  });

  it("can pick every other area", () => {
    const picked = [0, 0.5, 0.99].map((r) => pickArea(["a", "b", "c"], "a", r));
    expect(new Set(picked)).toEqual(new Set(["b", "c"]));
  });

  it("shows the only area there is, and any area on a first visit", () => {
    expect(pickArea(["a"], "a", 0.5)).toBe("a");
    expect(pickArea(["a", "b"], null, 0.99)).toBe("b");
  });
});

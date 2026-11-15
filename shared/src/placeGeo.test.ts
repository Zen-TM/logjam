import { describe, it, expect } from "vitest";
import {
  haversineMeters,
  lonBoxWithin,
  lonMid,
  lonTurn,
  lonNear,
  lonOverlap,
  lonWidth,
  lonWithin,
  wrapBox,
  wrapLon,
  withinBbox,
} from "./placeGeo.js";

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters(-33.5, 150.3, -33.5, 150.3)).toBe(0);
  });
  it("matches a known Sydney→Katoomba distance (~89 km)", () => {
    const d = haversineMeters(-33.8688, 151.2093, -33.7141, 150.3119);
    expect(d).toBeGreaterThan(82_000);
    expect(d).toBeLessThan(95_000);
  });
  it("computes sub-km distances correctly", () => {
    const d = haversineMeters(-33.5, 150.3, -33.5009, 150.3);
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
  });
});

describe("withinBbox", () => {
  it("returns true inside box", () => {
    expect(withinBbox(-33.5, 150.3, -33.49, 150.31, 0.05)).toBe(true);
  });
  it("returns false outside box", () => {
    expect(withinBbox(-33.5, 150.3, -33.3, 150.3, 0.05)).toBe(false);
  });

  // Mutation: compare the raw longitude difference again, in `withinBbox`
  // (`Math.abs(lng1 - lng2)`), and 179.98 and -179.99 read as 360 degrees apart.
  it("is true for two places either side of the date line, close or not", () => {
    expect(withinBbox(-17, 179.98, -17, -179.99, 0.05)).toBe(true);
    expect(withinBbox(-17, -179.99, -17, 179.98, 0.05)).toBe(true);
    expect(withinBbox(-17, 179, -17, -179, 0.05)).toBe(false);
    expect(withinBbox(-17, 179.98, -16.9, -179.99, 0.05)).toBe(false);
  });

  // Mutation: replace the `<=` on the longitude with `<` in `withinBbox`.
  it("counts a longitude difference of exactly the margin as inside", () => {
    expect(withinBbox(-33.5, 150.5, -33.5, 151, 0.5)).toBe(true);
    expect(withinBbox(-33.5, 151, -33.5, 150.5, 0.5)).toBe(true);
  });
});

describe("wrapLon", () => {
  // Mutation: make the fast path `lon >= -180 && lon <= 180` in `wrapLon`, and
  // 180 stays 180 where it is -180 everywhere else.
  it("wraps into [-180, 180)", () => {
    expect(wrapLon(-180)).toBe(-180);
    expect(wrapLon(180)).toBe(-180);
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(540)).toBe(-180);
    expect(wrapLon(-540)).toBe(-180);
    expect(wrapLon(360)).toBe(0);
    expect(wrapLon(150.3 + 360)).toBeCloseTo(150.3, 9);
  });

  // Mutation: in `wrapLon`, replace `lon - lonTurn(lon)` with
  // `wrapTurn(lon + 180) - 180`, and a longitude a hair below -180 comes back
  // as 180, outside [-180, 180).
  it("keeps the result below 180 for a longitude a hair under -180", () => {
    for (const lon of [-180 - 2.9e-14, -180 - 1e-13, -540 - 2.9e-14]) {
      const wrapped = wrapLon(lon);
      expect(wrapped).toBeGreaterThanOrEqual(-180);
      expect(wrapped).toBeLessThan(180);
    }
    expect(wrapLon(-180 - 2.9e-14)).toBeCloseTo(180, 9);
  });

  // Mutation: drop the fast path of `wrapLon` (return `wrapTurn(lon + 180) - 180`
  // always), and 150.3 comes back a hair off, which a grid or a margin then reads.
  it("returns a longitude already in range exactly as it was", () => {
    for (const lon of [150.3, -33.7, 0.05, 179.99999999999997, -180])
      expect(wrapLon(lon)).toBe(lon);
  });
});

describe("lonTurn", () => {
  // Mutation: use `Math.ceil` for `Math.round` in `lonTurn`, and 150.3 is
  // placed a turn over, in the next world copy.
  it("is the whole turns from [-180, 180) to the copy a longitude is in", () => {
    // `+ 0` reads a -0 as 0.
    expect(lonTurn(150.3) + 0).toBe(0);
    expect(lonTurn(-33.7) + 0).toBe(0);
    expect(lonTurn(-180) + 0).toBe(0);
    expect(lonTurn(180)).toBe(360);
    expect(lonTurn(150.3 + 360)).toBe(360);
    expect(lonTurn(-179.9 - 360)).toBe(-360);
    expect(lonTurn(540)).toBe(720);
  });
});

describe("lonWidth", () => {
  // Mutation: return `east - west` for a wrapped box too (drop the `wrapTurn`
  // in `lonWidth`), and 170 to -170 is a negative width.
  it("is the degrees a box spans, across the line when it is wrapped", () => {
    expect(lonWidth(150.2, 150.4)).toBeCloseTo(0.2, 9);
    expect(lonWidth(170, 190)).toBe(20);
    expect(lonWidth(170, -170)).toBe(20);
    expect(lonWidth(-190, -170)).toBe(20);
    expect(lonWidth(150, 150)).toBe(0);
  });

  // Mutation: wrap the width of an unwrapped box into [0, 360) in `lonWidth`,
  // and a box 400 wide reads 40 wide.
  it("keeps the width of an unwrapped box a turn or more wide", () => {
    expect(lonWidth(-200, 200)).toBe(400);
    expect(lonWidth(-180, 180)).toBe(360);
  });
});

describe("wrapBox", () => {
  const at = (centre: number) => ({
    west: centre - 1,
    south: -1,
    east: centre + 1,
    north: 1,
  });
  const centreOf = (view: { west: number; east: number }) =>
    (view.west + view.east) / 2;

  // Mutation: return the box as it is from `wrapBox` (set `turn` to 0).
  it("moves a box by whole turns until its centre is in [-180, 180)", () => {
    expect(centreOf(wrapBox(at(-180)))).toBe(-180);
    expect(centreOf(wrapBox(at(179.9)))).toBeCloseTo(179.9);
    expect(centreOf(wrapBox(at(180)))).toBe(-180);
    expect(centreOf(wrapBox(at(540)))).toBe(-180);
    expect(wrapBox(at(-190))).toEqual({
      west: 169,
      south: -1,
      east: 171,
      north: 1,
    });
  });

  // Mutation: take the centre in `wrapBox` as `(box.west + box.east) / 2`
  // (drop the unwrapping of `east`), and a box that arrives wrapped, 170 to
  // -170, has its centre at 0 and is left where it is.
  it("reads a box that arrives wrapped as the ground it runs across", () => {
    expect(wrapBox({ west: 170, east: -170 })).toEqual({
      west: -190,
      east: -170,
    });
    expect(wrapBox({ west: 530, east: 190 })).toEqual({
      west: -190,
      east: -170,
    });
    expect(wrapBox({ west: -10, east: 10 })).toEqual({ west: -10, east: 10 });
  });

  // Mutation: build the result in `wrapBox` from the fields it names, dropping
  // `...box`, and a box's other fields are lost.
  it("keeps every other field of the box, and the box itself when nothing moves", () => {
    const box = { ...at(150), scale: 25000 };
    expect(wrapBox(box)).toBe(box);
    expect(wrapBox({ ...at(150 + 360), scale: 25000 }).scale).toBe(25000);
  });
});

describe("lonNear", () => {
  // Mutation: use `Math.floor` for `Math.round` in `lonNear`, and -179.5 beside
  // 179.5 stays in its own copy, 359 degrees from it.
  it("is the copy of the longitude nearest the other", () => {
    expect(lonNear(-179.5, 179.5)).toBe(180.5);
    expect(lonNear(179.5, -179.5)).toBe(-180.5);
    expect(lonNear(150.3, 150.3 + 720)).toBe(150.3 + 720);
    expect(lonNear(150.3, 150.3 - 360)).toBe(150.3 - 360);
  });

  // Mutation: compute it as `near + wrapLon(lon - near)` in `lonNear`, and 150.3
  // beside 150.5 comes back a hair off.
  it("returns the longitude itself where it is already nearest", () => {
    expect(lonNear(150.3, 150.5)).toBe(150.3);
    expect(lonNear(-33.7, 100)).toBe(-33.7);
  });
});

describe("lonWithin", () => {
  // Mutation: a strict `<` in the last comparison of `lonBoxWithin` (the east edge drops out).
  it("is a plain inclusive range for a box that stays inside one world copy", () => {
    expect(lonWithin(150.3, 150.2, 150.4)).toBe(true);
    expect(lonWithin(150.2, 150.2, 150.4)).toBe(true);
    expect(lonWithin(150.4, 150.2, 150.4)).toBe(true);
    expect(lonWithin(150.5, 150.2, 150.4)).toBe(false);
    expect(lonWithin(-150.3, 150.2, 150.4)).toBe(false);
  });

  // Mutation: the last line of `lonBoxWithin` as `return innerWest >= west && innerEast <= east;`.
  it("holds both sides of 180 for a box that arrives unwrapped (east above 180)", () => {
    expect(lonWithin(175, 170, 190)).toBe(true);
    expect(lonWithin(-175, 170, 190)).toBe(true);
    expect(lonWithin(180, 170, 190)).toBe(true);
    expect(lonWithin(-170, 170, 190)).toBe(true);
    expect(lonWithin(-169, 170, 190)).toBe(false);
    expect(lonWithin(169, 170, 190)).toBe(false);
    expect(lonWithin(0, 170, 190)).toBe(false);
  });

  // Mutation: the last line of `lonBoxWithin` as `return innerWest >= west && innerEast <= east;`.
  it("holds both sides of -180 for a box that arrives unwrapped (west below -180)", () => {
    expect(lonWithin(-175, -190, -170)).toBe(true);
    expect(lonWithin(175, -190, -170)).toBe(true);
    expect(lonWithin(170, -190, -170)).toBe(true);
    expect(lonWithin(169, -190, -170)).toBe(false);
    expect(lonWithin(-169, -190, -170)).toBe(false);
  });

  // Mutation: in `lonWidth`, return `east - west` for a wrapped box too (drop
  // its `wrapTurn`), and a box 170 to -170 holds nothing.
  it("holds both sides of 180 for a box that arrives wrapped (west above east)", () => {
    expect(lonWithin(175, 170, -170)).toBe(true);
    expect(lonWithin(-175, 170, -170)).toBe(true);
    expect(lonWithin(170, 170, -170)).toBe(true);
    expect(lonWithin(-170, 170, -170)).toBe(true);
    expect(lonWithin(0, 170, -170)).toBe(false);
    expect(lonWithin(-169, 170, -170)).toBe(false);
  });

  // Mutation: the last line of `lonBoxWithin` as `return innerWest >= west && innerEast <= east;`.
  it("reads a box wholly in another world copy as the ground it shows", () => {
    // 520 to 540 is 160 to 180; -200 to -190 is 160 to 170.
    expect(lonWithin(170, 520, 540)).toBe(true);
    expect(lonWithin(-179, 520, 540)).toBe(false);
    expect(lonWithin(165, -200, -190)).toBe(true);
    expect(lonWithin(150.3, 510.2, 510.4)).toBe(true);
    expect(lonWithin(150.3, -209.8, -209.6)).toBe(true);
    expect(lonWithin(150.5, 510.2, 510.4)).toBe(false);
  });

  // Mutation: wrap both edges into [-180, 180] before comparing (a box 400 wide
  // becomes a wrapped box 320 wide, and the longitudes between its edges drop out).
  it("holds every longitude for a box a whole turn wide or more", () => {
    for (const lon of [-180, -90, 0, 90, 180]) {
      expect(lonWithin(lon, -200, 200)).toBe(true);
      expect(lonWithin(lon, -180, 180)).toBe(true);
    }
  });
});

describe("lonBoxWithin", () => {
  // Mutation: check only the inner box's west edge in `lonBoxWithin` (drop
  // `lonWidth(innerWest, innerEast)` from the sum), and a box that starts
  // inside and runs out past the east edge is held.
  it("holds a box only when both its edges are inside", () => {
    expect(lonBoxWithin(150, 152, 150.5, 151.5)).toBe(true);
    expect(lonBoxWithin(150, 152, 150, 152)).toBe(true);
    expect(lonBoxWithin(150, 152, 150.5, 152.5)).toBe(false);
    expect(lonBoxWithin(150, 152, 149.5, 151)).toBe(false);
    expect(lonBoxWithin(150, 152, 149, 153)).toBe(false);
  });

  // Mutation: delete the `span >= 360` line of `lonBoxWithin`, and a box
  // that runs a few degrees across the far edge of a whole turn is not held.
  it("holds every box in a box a turn wide or more", () => {
    expect(lonBoxWithin(-180, 180, 175, 185)).toBe(true);
    expect(lonBoxWithin(-200, 200, 100, 300)).toBe(true);
  });

  // Mutation: drop the `wrapTurn` from the offset in `lonBoxWithin`
  // (`innerWest - west`), and a box wholly west of the outer one is held.
  it("holds a box across the date line in a box across it, wrapped or not", () => {
    expect(lonBoxWithin(170, 190, 178, 182)).toBe(true);
    expect(lonBoxWithin(170, 190, -182, -178)).toBe(true);
    expect(lonBoxWithin(170, -170, 178, -178)).toBe(true);
    expect(lonBoxWithin(170, -170, 178 + 360, 182 + 360)).toBe(true);
    expect(lonBoxWithin(170, 190, 160, 165)).toBe(false);
    expect(lonBoxWithin(170, 190, 175, 195)).toBe(false);
    expect(lonBoxWithin(170, -170, -175, -165)).toBe(false);
  });
});

describe("lonMid", () => {
  // Mutation: return `(west + east) / 2` from `lonMid`, and a box that arrives
  // wrapped, 170 to -170, has its middle at 0.
  it("is the middle of a box, across the date line when it is wrapped", () => {
    expect(lonMid(150, 152)).toBe(151);
    expect(lonMid(170, 190)).toBe(180);
    expect(lonMid(170, -170)).toBe(180);
    expect(lonMid(-190, -170)).toBe(-180);
    expect(lonMid(-200, 200)).toBe(0);
  });
});

describe("lonOverlap", () => {
  // Mutation: replace `width >= 0` with `width > 0` in `lonOverlap`, and ranges
  // that touch read as apart.
  it("is the width where two ranges meet, 0 where they touch, null where they do not", () => {
    expect(lonOverlap(150, 151, 150.5, 152)).toBeCloseTo(0.5, 9);
    expect(lonOverlap(150, 151, 150.2, 150.4)).toBeCloseTo(0.2, 9);
    expect(lonOverlap(150, 151, 151, 152)).toBe(0);
    expect(lonOverlap(150, 151, 152, 153)).toBeNull();
    expect(lonOverlap(150, 151, 148, 149)).toBeNull();
  });

  // Mutation: in `lonOverlap` measure the other range from `west` by shifts
  // (`shift = wrapTurn(otherWest - west) - 360`, up by 360 while `shift <=
  // span`, width `Math.min(span, shift + otherSpan) - Math.max(0, shift)`), and
  // ranges whose edges are the same non-integer longitude read as apart.
  it("meets in a width of 0 where non-integer edges are the same longitude", () => {
    const edges = [150.3, 151.7, 0.1, 0.7, 33.3, 33.9, 148.9, 149.2, 150.1];
    for (const a of edges)
      for (const b of edges) {
        if (a === b) continue;
        const [low, high] = a < b ? [a, b] : [b, a];
        // The range ending where the other starts, both ways round.
        expect(lonOverlap(low - 1, low, low, high)).toBe(0);
        expect(lonOverlap(low, high, low - 1, low)).toBe(0);
        expect(lonOverlap(low, high, high, high + 1)).toBe(0);
        expect(lonOverlap(high, high + 1, low, high)).toBe(0);
      }
  });

  // Mutation: start the loop's `turns` at `Math.floor(raw / 360)` without the
  // `+ 1` in `lonOverlap`, and a range starting below `west` misses it.
  it("sees a range that starts below the first one's west edge", () => {
    expect(lonOverlap(170, 190, 160, 175)).toBe(5);
    expect(lonOverlap(150, 151, 149.5, 150.25)).toBeCloseTo(0.25, 9);
  });

  // Mutation: stop the loop in `lonOverlap` at the copy of the other range at
  // `west` (`otherLow <= top` as `otherLow <= west`), and ranges either side
  // of 180 read as apart.
  it("meets across the date line, whatever world copy each range is in", () => {
    expect(lonOverlap(170, 190, -175, -170)).toBe(5);
    expect(lonOverlap(170, 190, 530, 540)).toBe(10);
    expect(lonOverlap(170, 190, -550, -540)).toBe(10);
    expect(lonOverlap(170, -170, 175, 185)).toBe(10);
    expect(lonOverlap(175, 185, 170, -170)).toBe(10);
    expect(lonOverlap(170, 190, -170, -160)).toBe(0);
    expect(lonOverlap(170, 190, -169, -160)).toBeNull();
  });

  // Mutation: keep the first meeting `lonOverlap` finds (`widest === null ||
  // width > widest` as `widest === null`), and a range 400 wide reads the
  // touch at 0 and not the 10 degrees at 350.
  it("takes the widest meeting among the world copies a range this wide reaches", () => {
    expect(lonOverlap(0, 400, -10, 0)).toBe(10);
    expect(lonOverlap(-10, 0, 0, 400)).toBe(10);
  });
});

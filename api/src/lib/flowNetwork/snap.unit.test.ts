import { describe, expect, it } from "vitest";
import {
  FLOW_NETWORK_BIGGER_FACTOR,
  FLOW_NETWORK_SNAP_M,
} from "@logjam/shared";
import type { Position } from "./gpkgGeometry";
import {
  bboxOf,
  blend,
  boxAround,
  chooseCreek,
  downstreamBearing,
  inPolygons,
  lineDownTo,
  localFrame,
  nearestOnLine,
  walkWithinCap,
} from "./snap";

/** Near Katoomba, where a degree of longitude is about 92.6 km. */
const ORIGIN: Position = [150.31, -33.7];
const frame = localFrame(ORIGIN);
/** A point `east` and `north` metres from ORIGIN. */
const at = (east: number, north: number) => frame.toDegrees([east, north]);

describe("localFrame", () => {
  // Mutation: drop the cos(latitude) and an east-west metre comes out ~20% short.
  it("measures a degree of longitude shorter than one of latitude", () => {
    const [east] = frame.toMetres([ORIGIN[0] + 1, ORIGIN[1]]);
    const [, north] = frame.toMetres([ORIGIN[0], ORIGIN[1] + 1]);
    expect(north).toBeCloseTo(111_195, -1);
    expect(east / north).toBeCloseTo(Math.cos((33.7 * Math.PI) / 180), 6);
  });

  it("round-trips", () => {
    const p: Position = [150.3123, -33.7045];
    const back = frame.toDegrees(frame.toMetres(p));
    expect(back[0]).toBeCloseTo(p[0], 12);
    expect(back[1]).toBeCloseTo(p[1], 12);
  });
});

describe("boxAround", () => {
  // Mutation: use the latitude's degrees for longitude too and the box is too
  // narrow east-west, so a creek 50 m east is never a candidate.
  it("reaches the distance in every direction", () => {
    const box = boxAround(ORIGIN, 50);
    const [east] = frame.toMetres([box.east, ORIGIN[1]]);
    const [west] = frame.toMetres([box.west, ORIGIN[1]]);
    const [, north] = frame.toMetres([ORIGIN[0], box.north]);
    const [, south] = frame.toMetres([ORIGIN[0], box.south]);
    expect([east, -west, north, -south].map(Math.round)).toEqual([
      50, 50, 50, 50,
    ]);
  });
});

describe("nearestOnLine", () => {
  // An L: 100 m east, then 100 m north.
  const line = [at(0, 0), at(100, 0), at(100, 100)];

  // Mutation: measure the fraction along the leg instead of the whole line
  // and the 0.75 below reads 0.5.
  it("finds the foot of the perpendicular, its distance and how far along", () => {
    const near = nearestOnLine(line, at(80, 50))!;
    expect(near.distanceM).toBeCloseTo(20, 3);
    // Not exact: nearestOnLine measures in a frame centred on the click.
    expect(near.fraction).toBeCloseTo(0.75, 5);
    expect(near.leg).toBe(1);
    const [x, y] = frame.toMetres(near.position);
    expect(x).toBeCloseTo(100, 3);
    expect(y).toBeCloseTo(50, 3);
  });

  // Mutation: leave t unclamped and a point past the end projects off the line.
  it("stops at the ends", () => {
    const before = nearestOnLine(line, at(-30, -40))!;
    expect(before.distanceM).toBeCloseTo(50, 3);
    expect(before.fraction).toBe(0);
    const after = nearestOnLine(line, at(100, 130))!;
    expect(after.distanceM).toBeCloseTo(30, 3);
    expect(after.fraction).toBeCloseTo(1, 9);
  });

  it("handles a one-vertex line and an empty one", () => {
    expect(nearestOnLine([at(3, 4)], ORIGIN)!.distanceM).toBeCloseTo(5, 6);
    expect(nearestOnLine([], ORIGIN)).toBeNull();
  });

  // Mutation: keep the whole line in lineDownTo and the drawn catchment runs
  // on past the click to the next junction.
  it("cuts a line at its nearest point", () => {
    const near = nearestOnLine(line, at(80, 50))!;
    const head = lineDownTo(line, near);
    expect(head).toHaveLength(3);
    expect(head.slice(0, 2)).toEqual(line.slice(0, 2));
    expect(head[2]).toEqual(near.position);
  });
});

describe("downstreamBearing", () => {
  // Mutation: swap the arguments of atan2 and an eastward creek points north.
  it("points the way the line runs", () => {
    const east = [at(0, 0), at(200, 0)];
    expect(downstreamBearing(east, nearestOnLine(east, at(100, 5))!)).toBe(90);
    const south = [at(0, 0), at(0, -200)];
    expect(downstreamBearing(south, nearestOnLine(south, at(3, -100))!)).toBe(
      180,
    );
  });

  // Mutation: take the direction of the one leg the snap is on, and a D8
  // step across a creek running east reads as north.
  it("follows the creek, not the 5 m step it was snapped onto", () => {
    // East in 5 m stairs: 5 east, 5 north, 5 east, 5 south, ...
    const stairs: Position[] = [];
    for (let i = 0; i <= 20; i++) {
      stairs.push(at(i * 5, 0), at(i * 5, i % 2 === 0 ? 5 : 0));
    }
    const near = nearestOnLine(stairs, at(50, 2.5))!;
    expect(downstreamBearing(stairs, near)).toBeGreaterThan(75);
    expect(downstreamBearing(stairs, near)).toBeLessThan(105);
  });

  it("has no direction on a line without length", () => {
    const dot = [at(1, 1), at(1, 1)];
    expect(downstreamBearing(dot, nearestOnLine(dot, ORIGIN)!)).toBeNull();
  });
});

describe("blend", () => {
  // Mutation: swap start and end.
  it("runs from the start's area to the end's", () => {
    expect(blend(10, 30, 0)).toBe(10);
    expect(blend(10, 30, 0.25)).toBe(15);
    expect(blend(10, 30, 1)).toBe(30);
  });
});

describe("chooseCreek", () => {
  const c = (distanceM: number, catchmentKm2: number) => ({
    distanceM,
    catchmentKm2,
  });

  // Mutation: compare with < instead of <= and a creek at exactly 50 m is lost.
  it("takes the nearest in range, the edge included", () => {
    expect(chooseCreek([c(30, 1), c(10, 2)])!.chosen).toEqual(c(10, 2));
    expect(chooseCreek([c(FLOW_NETWORK_SNAP_M, 1)])!.chosen).toEqual(
      c(FLOW_NETWORK_SNAP_M, 1),
    );
    expect(chooseCreek([c(FLOW_NETWORK_SNAP_M + 0.1, 1)])).toBeNull();
    expect(chooseCreek([])).toBeNull();
  });

  // Mutation: break ties on order of arrival and a click on a junction can
  // read the tributary's area.
  it("takes the bigger of two equally near", () => {
    expect(chooseCreek([c(5, 1), c(5, 9)])!.chosen).toEqual(c(5, 9));
  });

  // Mutation: compare against the factor with > and a creek exactly three
  // times as big goes unmentioned; or drop the range filter and a river
  // 60 m away is mentioned.
  it("mentions the biggest creek in range draining the factor or more", () => {
    const chosen = c(5, 2);
    const exactly = c(30, 2 * FLOW_NETWORK_BIGGER_FACTOR);
    const biggest = c(40, 50);
    const outOfRange = c(FLOW_NETWORK_SNAP_M + 10, 500);
    const result = chooseCreek([chosen, exactly, biggest, outOfRange])!;
    expect(result.chosen).toBe(chosen);
    expect(result.biggerNearby).toBe(biggest);
    expect(chooseCreek([chosen, exactly])!.biggerNearby).toBe(exactly);
    expect(
      chooseCreek([chosen, c(30, 2 * FLOW_NETWORK_BIGGER_FACTOR - 0.01)])!
        .biggerNearby,
    ).toBeUndefined();
    expect(chooseCreek([chosen, outOfRange])!.biggerNearby).toBeUndefined();
  });
});

describe("inPolygons", () => {
  const square: Position[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];
  const hole: Position[] = [
    [4, 4],
    [6, 4],
    [6, 6],
    [4, 6],
    [4, 4],
  ];
  const away: Position[] = square.map(([x, y]) => [x + 20, y]);

  // Mutation: test only the outer ring and a point in the hole reads inside.
  it("is inside the outer ring and outside its holes", () => {
    expect(inPolygons([[square, hole]], [2, 2])).toBe(true);
    expect(inPolygons([[square, hole]], [5, 5])).toBe(false);
    expect(inPolygons([[square, hole]], [12, 5])).toBe(false);
  });

  // Mutation: look only at the first polygon.
  it("is inside any of several polygons", () => {
    expect(inPolygons([[square], [away]], [25, 5])).toBe(true);
    expect(inPolygons([[square], [away]], [15, 5])).toBe(false);
    expect(inPolygons([], [5, 5])).toBe(false);
  });
});

describe("walkWithinCap", () => {
  const of = (order: number, n: number) =>
    Array.from({ length: n }, () => ({ streamOrder: order }));
  const segments = [...of(1, 50), ...of(2, 20), ...of(3, 8), ...of(4, 2)];
  /** A walk over `segments` that records what it was asked for. */
  function walker() {
    const asked: [number, number | null][] = [];
    const walk = (minOrder: number, limit: number | null) => {
      asked.push([minOrder, limit]);
      const found = segments.filter((s) => s.streamOrder >= minOrder);
      return limit === null ? found : found.slice(0, limit);
    };
    return { walk, asked };
  }

  it("keeps everything within the cap and says nothing", () => {
    const { walk } = walker();
    const thinned = walkWithinCap(walk, 4, 80);
    expect(thinned.kept).toHaveLength(80);
    expect(thinned.trimmedBelowOrder).toBeUndefined();
  });

  // Mutation: drop one order too many (or too few): the first case keeps 10
  // (or 30, over the cap) instead of 30.
  it("drops the lowest orders, whole, until the rest fits", () => {
    const thinned = walkWithinCap(walker().walk, 4, 30);
    expect(thinned.kept).toHaveLength(30);
    expect(thinned.trimmedBelowOrder).toBe(2);
    expect(thinned.kept.every((s) => s.streamOrder >= 2)).toBe(true);

    expect(walkWithinCap(walker().walk, 4, 29).trimmedBelowOrder).toBe(3);
    expect(walkWithinCap(walker().walk, 4, 29).kept).toHaveLength(10);
  });

  // The point of the walk: a huge catchment is never read whole. Mutation:
  // pass null (no limit) for the lower orders and the walk of order 1 reads
  // all 80 segments.
  it("never asks a lower order for more than one over the cap", () => {
    const { walk, asked } = walker();
    walkWithinCap(walk, 4, 9);
    expect(asked).toEqual([
      [1, 10],
      [2, 10],
      [3, 10],
      [4, null],
    ]);
  });

  // Mutation: limit the clicked order's walk too and a long main stem is cut
  // short of its head.
  it("always keeps the clicked segment's order, whole", () => {
    const { walk, asked } = walker();
    const thinned = walkWithinCap(walk, 4, 1);
    expect(thinned.trimmedBelowOrder).toBe(4);
    expect(thinned.kept).toHaveLength(2);
    expect(asked.at(-1)).toEqual([4, null]);
  });

  it("walks a first-order creek whole and calls nothing trimmed", () => {
    const { walk, asked } = walker();
    expect(walkWithinCap(walk, 1, 5).trimmedBelowOrder).toBeUndefined();
    expect(asked).toEqual([[1, null]]);
  });
});

describe("bboxOf", () => {
  it("spans every vertex of every line", () => {
    expect(
      bboxOf([
        [
          [150.1, -33.5],
          [150.4, -33.9],
        ],
        [[150.2, -33.2]],
      ]),
    ).toEqual([150.1, -33.9, 150.4, -33.2]);
    expect(bboxOf([])).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  gaugeFeedAt,
  gaugeFeedIn,
  gaugeFeedOf,
  gaugeIdsByFeed,
  tripGaugeIdsByFeed,
  gaugeLatestPath,
} from "./index.js";
import { GAUGE_PREFIX, TRIP_GAUGE_MAX } from "./gauges.js";
import { NSW_REGION, type Region } from "./regions.js";
import { SIM_NZ, SIM_UTAH } from "./simRegions.js";

const NZ_FEED = "master/gauges/simnz/v1/";
const nz: Region = { ...SIM_NZ, gauges: NZ_FEED };
const regions = [NSW_REGION, nz, SIM_UTAH];
const [nzLon, nzLat] = nz.view.center;
const [utahLon, utahLat] = SIM_UTAH.view.center;
const over = (lon: number, lat: number) => ({
  west: lon - 0.05,
  south: lat - 0.05,
  east: lon + 0.05,
  north: lat + 0.05,
});

describe("gaugeFeedOf", () => {
  // Mutation: return `GAUGE_PREFIX` for a region with no feed → red.
  it("is the region's own prefix, and null where it declares none", () => {
    expect(gaugeFeedOf(NSW_REGION)).toBe(GAUGE_PREFIX);
    expect(gaugeFeedOf(nz)).toBe(NZ_FEED);
    expect(gaugeFeedOf(SIM_UTAH)).toBeNull();
    expect(gaugeFeedOf(null)).toBeNull();
  });
});

describe("gaugeFeedIn", () => {
  // Mutation: return NSW's `GAUGE_PREFIX` whatever the view → red.
  it("is the feed of the region the map shows", () => {
    expect(gaugeFeedIn(over(150.31, -33.7), regions)).toBe(GAUGE_PREFIX);
    expect(gaugeFeedIn(over(nzLon, nzLat), regions)).toBe(NZ_FEED);
  });

  // Mutation: fall back to the first region with a feed when the view's own
  // has none → red.
  it("is null over a region with no feed, over none, and for an unknown view", () => {
    expect(gaugeFeedIn(over(utahLon, utahLat), regions)).toBeNull();
    expect(gaugeFeedIn(over(156, -33), regions)).toBeNull();
    expect(gaugeFeedIn(null, regions)).toBeNull();
    expect(gaugeFeedIn(undefined, regions)).toBeNull();
  });

  // Mutation: read the box only as given in `regionTouchesBox` (set `first` and
  // `last` to 0) and the centre unwrapped in `regionInView` → red.
  it("reads a map panned once round the world", () => {
    expect(gaugeFeedIn(over(nzLon + 360, nzLat), regions)).toBe(NZ_FEED);
  });
});

describe("gaugeFeedAt", () => {
  // Mutation: read the first region's feed whatever the point → red.
  it("is the feed of the region the point falls in", () => {
    expect(gaugeFeedAt(150.31, -33.7, regions)).toBe(GAUGE_PREFIX);
    expect(gaugeFeedAt(nzLon, nzLat, regions)).toBe(NZ_FEED);
    expect(gaugeFeedAt(utahLon, utahLat, regions)).toBeNull();
    expect(gaugeFeedAt(156, -33, regions)).toBeNull();
  });
});

describe("gaugeIdsByFeed", () => {
  const nswPlace = (gaugeId: string | null) => ({
    longitude: 150.31,
    latitude: -33.7,
    gaugeId,
  });
  const nzPlace = (gaugeId: string | null) => ({
    longitude: nzLon,
    latitude: nzLat,
    gaugeId,
  });

  // Mutation: group every id under the first place's feed → red.
  it("groups each gauge under the feed of its place's region, in order", () => {
    expect(
      gaugeIdsByFeed(
        [nswPlace("a1"), nzPlace("b1"), nswPlace("a2"), nzPlace(null)],
        regions,
      ),
    ).toEqual([
      { feed: GAUGE_PREFIX, gaugeIds: ["a1", "a2"] },
      { feed: NZ_FEED, gaugeIds: ["b1"] },
    ]);
  });

  // Mutation: keep a gauge whose place is outside every feed → red.
  it("drops a gauge whose place is in no region with a feed", () => {
    const utah = { longitude: utahLon, latitude: utahLat, gaugeId: "u1" };
    expect(gaugeIdsByFeed([utah, nswPlace("a1")], regions)).toEqual([
      { feed: GAUGE_PREFIX, gaugeIds: ["a1"] },
    ]);
    expect(gaugeIdsByFeed([utah], regions)).toEqual([]);
  });

  // Mutation: stop `gaugeIdsByFeed` at `TRIP_GAUGE_MAX` → red.
  it("lists every gauge of the places it is given, each once", () => {
    const ids = Array.from({ length: TRIP_GAUGE_MAX + 2 }, (_, i) => `a${i}`);
    expect(gaugeIdsByFeed([...ids, ...ids].map(nswPlace), regions)).toEqual([
      { feed: GAUGE_PREFIX, gaugeIds: ids },
    ]);
  });
});

describe("tripGaugeIdsByFeed", () => {
  const nswPlace = (gaugeId: string | null) => ({
    longitude: 150.31,
    latitude: -33.7,
    gaugeId,
  });

  // Mutation: let a place with no feed use up one of the slots, or drop the cap → red.
  it("lists at most TRIP_GAUGE_MAX gauges, counting only those it keeps", () => {
    const utah = { longitude: utahLon, latitude: utahLat, gaugeId: "u1" };
    const ids = Array.from({ length: TRIP_GAUGE_MAX + 2 }, (_, i) => `a${i}`);
    const kept = tripGaugeIdsByFeed(
      [utah, nswPlace("a0"), ...ids.map(nswPlace)],
      regions,
    );
    expect(kept).toEqual([
      { feed: GAUGE_PREFIX, gaugeIds: ids.slice(0, TRIP_GAUGE_MAX) },
    ]);
  });
});

describe("gaugeLatestPath", () => {
  // Mutation: build the path from `GAUGE_PREFIX` whatever the feed → red.
  it("names the latest file of the feed it is handed", () => {
    expect(gaugeLatestPath(GAUGE_PREFIX)).toBe("master/gauges/v1/latest.json");
    expect(gaugeLatestPath(NZ_FEED)).toBe(`${NZ_FEED}latest.json`);
  });
});

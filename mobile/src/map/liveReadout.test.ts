import { describe, expect, it } from "vitest";

import { FIX_COARSE_M, FIX_STALE_MS } from "./gpsSignal";
import {
  deriveSpeedMps,
  getLiveReadout,
  keepWithValue,
  publishLiveReadout,
  publishTerrainElevation,
  readoutFigures,
  refreshLiveReadout,
} from "./liveReadout";

const at = (
  atMs: number,
  speedMps: number | null,
  lat = -33.56,
  lon = 150.4,
) => ({
  lat,
  lon,
  speedMps,
  timeMs: atMs,
});

describe("deriveSpeedMps", () => {
  it("believes the platform's own speed when it has one", () => {
    expect(deriveSpeedMps(at(3000, 1.4), at(0, null))).toBe(1.4);
  });

  it("keeps a reported standstill as zero, not as unknown", () => {
    expect(deriveSpeedMps(at(3000, 0), at(0, null))).toBe(0);
  });

  it("differences two fixes when the platform won't say", () => {
    // ~100 m of longitude at this latitude, over 10 s.
    const previous = at(0, null, -33.56, 150.4);
    const current = at(10_000, -1, -33.56, 150.4 + 0.001077);
    const speed = deriveSpeedMps(current, previous);
    expect(speed).not.toBeNull();
    expect(speed!).toBeGreaterThan(9);
    expect(speed!).toBeLessThan(11);
  });

  it("refuses a gap too short to be travel — that is delivery jitter", () => {
    const previous = at(0, null, -33.56, 150.4);
    const current = at(200, null, -33.56, 150.40005);
    expect(deriveSpeedMps(current, previous)).toBeNull();
  });

  it("refuses a gap long enough to be a different question", () => {
    const previous = at(0, null, -33.56, 150.4);
    const current = at(FIX_STALE_MS + 1000, null, -33.56, 150.41);
    expect(deriveSpeedMps(current, previous)).toBeNull();
  });

  it("has no answer at all on the first fix with no platform speed", () => {
    expect(deriveSpeedMps(at(0, null), null)).toBeNull();
    expect(deriveSpeedMps(at(0, -1), null)).toBeNull();
  });
});

// Mutation that turns it red: compare against a constant of its own (60_000)
// instead of `fixQuality`, and the 30 s case below keeps a speed it must drop.
describe("readoutFigures", () => {
  const NOW = 1_700_000_000_000;
  const readout = (ageMs: number, accuracyM: number | null = 8) => ({
    speedMps: 1.4,
    elevationM: 253,
    fromTerrain: false,
    atMs: NOW - ageMs,
    accuracyM,
  });

  it("keeps a fresh fix's figures and says nothing about age", () => {
    expect(readoutFigures(readout(3000), NOW)).toEqual({
      quality: "live",
      speedMps: 1.4,
      elevationM: 253,
      age: null,
    });
  });

  it("drops the speed and ages the height once the fix is stale", () => {
    expect(readoutFigures(readout(30_000), NOW)).toEqual({
      quality: "stale",
      speedMps: null,
      elevationM: 253,
      age: "30 s ago",
    });
  });

  it("greys at the same cliff as the arrow", () => {
    expect(readoutFigures(readout(FIX_STALE_MS + 1), NOW).quality).toBe(
      "stale",
    );
    expect(readoutFigures(readout(FIX_STALE_MS - 1), NOW).quality).toBe("live");
  });

  it("calls a tower fix coarse and keeps its figures", () => {
    const figures = readoutFigures(readout(1000, FIX_COARSE_M + 1), NOW);
    expect(figures.quality).toBe("coarse");
    expect(figures.speedMps).toBe(1.4);
  });

  it("has no figures and no age before the first fix", () => {
    expect(readoutFigures(null, NOW)).toEqual({
      quality: "stale",
      speedMps: null,
      elevationM: null,
      age: null,
    });
  });
});

// Mutations that turn these red: delete the `refreshLiveReadout` call in
// MapScreen's watcher (the chip greys 20 s after you stop walking), or make
// `publishTerrainElevation` rebuild the reading it was asked for (a slow tile
// read puts the old age and speed back).
describe("the published reading", () => {
  const base = {
    speedMps: 1.4,
    elevationM: 253,
    fromTerrain: false,
    atMs: 1000,
    accuracyM: 8,
  };

  it("a refresh moves the age and speed and keeps the height", () => {
    publishLiveReadout({ ...base, fromTerrain: true });
    refreshLiveReadout(9000, 30, 0);
    expect(getLiveReadout()).toEqual({
      speedMps: 0,
      elevationM: 253,
      fromTerrain: true,
      atMs: 9000,
      accuracyM: 30,
    });
  });

  it("a refresh before any reading publishes nothing", () => {
    publishLiveReadout(null);
    refreshLiveReadout(9000, 30, 0);
    expect(getLiveReadout()).toBeNull();
  });

  it("a late terrain height does not undo a later refresh", () => {
    publishLiveReadout(base);
    refreshLiveReadout(9000, 8, 0);
    publishTerrainElevation(260);
    expect(getLiveReadout()).toMatchObject({
      elevationM: 260,
      fromTerrain: true,
      atMs: 9000,
      speedMps: 0,
    });
  });
});

// Mutation: return `unit` unchanged, and "km/h" wraps under its figure at a
// large text size.
describe("keepWithValue", () => {
  it("joins the unit to its figure with a no-break space", () => {
    expect(keepWithValue(" km/h")).toBe("\u00A0km/h");
    expect(keepWithValue("")).toBe("");
  });
});

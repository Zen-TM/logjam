import { describe, expect, it } from "vitest";
import type { GeoPdfConfig } from "@logjam/shared";
import { readSettings, settingsOf } from "./geoPdfSettings";

const BASE_LAYERS = ["six-topo", "six-imagery"];
const config: GeoPdfConfig = {
  paperSize: "A3",
  orientation: "landscape",
  extent: { north: -33.61234, south: -33.7, east: 150.45678, west: 150.3 },
  scale: 15000,
  baseLayer: "six-topo",
  overlays: ["contours", "slope"],
  elements: {
    title: "Secret Gorge",
    compass: true,
    scaleText: false,
    scaleBar: true,
    gridLines: "enNorthing",
  },
  placeMarkers: [{ lat: -33.65, lon: 150.4, name: "Camp", color: "owned" }],
};
const choice = { overlays: ["contours"], terrainPinned: true };
const read = (stored: unknown) => readSettings(stored, BASE_LAYERS);

describe("settingsOf", () => {
  // Mutation: return the whole config, and the title, extent and markers land
  // in localStorage.
  it("holds no title, extent or place marker", () => {
    const json = JSON.stringify(settingsOf(config, choice));
    for (const secret of ["Secret", "33.61234", "150.45678", "Camp", "extent"])
      expect(json).not.toContain(secret);
  });

  it("reads back what it stored", () => {
    const stored = settingsOf(config, choice);
    expect(read(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  // The user's own choice, not the effective set: a job in the area turns
  // Terrain on without one. Mutation: store `config.overlays` instead.
  it("stores the overlays chosen, not the ones sent", () => {
    const stored = settingsOf(config, {
      overlays: ["vegetation"],
      terrainPinned: false,
    });
    expect(stored.overlays).toEqual(["vegetation"]);
    expect(stored.terrainPinned).toBe(false);
  });

  // Mutation: store config.scale as it is, and a scale left at 24999.999…
  // by a typed edge opens on Other instead of 1:25,000.
  it("rounds the scale to a whole number", () => {
    expect(
      settingsOf({ ...config, scale: 24999.999999995 }, choice).scale,
    ).toBe(25000);
  });

  it("round-trips a custom paper and its ratio", () => {
    const custom = {
      ...config,
      paperSize: "custom",
      customRatio: { w: 200, h: 300 },
    } as GeoPdfConfig;
    expect(read(settingsOf(custom, choice))).toMatchObject({
      paperSize: "custom",
      customRatio: { w: 200, h: 300 },
    });
  });
});

describe("readSettings", () => {
  it("drops each field that no longer validates and keeps the rest", () => {
    expect(
      read({
        paperSize: "A0",
        orientation: "landscape",
        scale: -5,
        baseLayer: "gone",
        overlays: ["contours", "features"],
        compass: "yes",
        scaleBar: false,
        gridLines: "utm",
        terrainPinned: "yes",
      }),
    ).toEqual({
      orientation: "landscape",
      overlays: ["contours"],
      scaleBar: false,
    });
  });

  it.each([null, "x", 7, [], undefined])("takes %j as nothing stored", (v) => {
    expect(read(v)).toEqual({});
  });

  it("drops a custom ratio that is only partly valid", () => {
    for (const customRatio of [
      { w: 200 },
      { w: 200, h: 0 },
      { w: "a", h: 3 },
      5,
    ])
      expect(read({ customRatio })).toEqual({});
  });

  it("drops an overlay list holding a non-string", () => {
    expect(read({ overlays: ["contours", 3] })).toEqual({});
  });

  // Mutation: let a list that filters to empty through, and the dialog pins
  // "no overlays" because of names that have since gone.
  it("falls back to the default for a list of names that have all gone", () => {
    expect(read({ overlays: ["features", "gone"] })).toEqual({});
  });

  // Mutation: read `terrainPinned` outside the accepted-list branch, and the
  // dialog opens with Terrain pinned to seeds nobody chose.
  it("drops the pin with an overlay list that is all stale", () => {
    expect(read({ overlays: ["gone"], terrainPinned: true })).toEqual({});
    expect(read({ overlays: ["contours"], terrainPinned: true })).toEqual({
      overlays: ["contours"],
      terrainPinned: true,
    });
  });

  it("keeps an empty list as a choice of none", () => {
    expect(read({ overlays: [] })).toEqual({ overlays: [] });
  });

  it("keeps a grid type, and no grid", () => {
    expect(read({ gridLines: "latlon" })).toEqual({ gridLines: "latlon" });
    expect(read({ gridLines: null })).toEqual({ gridLines: null });
  });

  // Mutation: accept any string, and a stored "osm" selects no chip yet is
  // still printed. The dialog passes the list it offers (the render test
  // "takes a stored base layer the dialog offers, not one it does not" holds
  // the wiring).
  it("takes a base layer only from the ones the dialog offers", () => {
    expect(read({ baseLayer: "six-imagery" })).toEqual({
      baseLayer: "six-imagery",
    });
    expect(read({ baseLayer: "osm" })).toEqual({});
  });
});

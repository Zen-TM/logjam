import { describe, expect, it } from "vitest";
import type { GeoPdfConfig } from "@logjam/shared";
import { readSettings, settingsOf } from "./geoPdfSettings";

const config: GeoPdfConfig = {
  paperSize: "A3",
  orientation: "landscape",
  extent: { north: -33.61234, south: -33.7, east: 150.45678, west: 150.3 },
  scale: 15000,
  baseLayer: "six-topo",
  overlays: ["contours"],
  elements: {
    title: "Secret Gorge",
    compass: true,
    scaleText: false,
    scaleBar: true,
    gridLines: "enNorthing",
  },
  placeMarkers: [{ lat: -33.65, lon: 150.4, name: "Camp", color: "owned" }],
};

describe("settingsOf", () => {
  // Mutation: return the whole config, and the title, extent and markers land
  // in localStorage.
  it("holds no title, extent or place marker", () => {
    const json = JSON.stringify(settingsOf(config));
    for (const secret of ["Secret", "33.61234", "150.45678", "Camp", "extent"])
      expect(json).not.toContain(secret);
  });

  it("reads back what it stored", () => {
    expect(
      readSettings(JSON.parse(JSON.stringify(settingsOf(config)))),
    ).toEqual(settingsOf(config));
  });
});

describe("readSettings", () => {
  it("drops each field that no longer validates and keeps the rest", () => {
    expect(
      readSettings({
        paperSize: "A0",
        orientation: "landscape",
        scale: -5,
        baseLayer: "gone",
        overlays: ["contours", "features"],
        compass: "yes",
        scaleBar: false,
        gridLines: "utm",
      }),
    ).toEqual({
      orientation: "landscape",
      overlays: ["contours"],
      scaleBar: false,
    });
  });

  it.each([null, "x", 7, [], undefined])("takes %j as nothing stored", (v) => {
    expect(readSettings(v)).toEqual({});
  });
});

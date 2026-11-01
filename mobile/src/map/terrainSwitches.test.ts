import { describe, expect, it } from "vitest";
import { MAP_TERRAIN, TERRAIN_LAYER_KEYS } from "@logjam/shared";
import { terrainSwitch } from "./terrainSwitches";

const copy = MAP_TERRAIN.copy;
const clip = (
  kind: string,
  logicalKey: string,
  minzoom: number | null = 8,
) => ({
  kind: kind as never,
  logicalKey,
  minzoom,
});
const saved = [
  clip("contours-region", "nsw-contours"),
  clip("slope-region", "nsw-5m-slope"),
  clip("land-region", "nsw-land"),
  clip("dem-region", "nsw-5m"),
];

describe("terrainSwitch", () => {
  // Mutation: return `checked: stored` in the basemap cases, and a stored-on
  // contours switch reads ON, dimmed, over a sheet that prints its own.
  it("reads OFF while a basemap disables it, with the basemap's reason", () => {
    expect(terrainSwitch("contours", true, "six-topo", true, saved)).toEqual({
      checked: false,
      disabled: true,
      reason: copy.contoursPrinted,
    });
    expect(
      terrainSwitch("hillshade", true, "six-imagery", true, saved),
    ).toEqual({
      checked: false,
      disabled: true,
      reason: copy.hillshadeImagery,
    });
    // The stored choice comes back on a basemap that can draw it.
    expect(
      terrainSwitch("hillshade", true, "six-topo", true, saved).checked,
    ).toBe(true);
  });

  // Mutation: test `online` before the basemap, and imagery offline says
  // "Needs a connection" instead of the reason that still holds online.
  it("the basemap's reason outranks the connection's", () => {
    expect(
      terrainSwitch("hillshade", true, "six-imagery", false, []).reason,
    ).toBe(copy.hillshadeImagery);
  });

  // Mutation: drop the `saved` test for one key (slope or contours), and a
  // switch is on with nothing to draw, or off despite a saved clip.
  it("offline, every layer needs a saved clip of itself", () => {
    for (const key of TERRAIN_LAYER_KEYS) {
      const off = terrainSwitch(key, true, "protomaps", false, []);
      expect(off).toEqual({
        checked: true,
        disabled: true,
        reason: "Needs a connection",
      });
      expect(terrainSwitch(key, true, "protomaps", false, saved).disabled).toBe(
        false,
      );
      expect(terrainSwitch(key, true, "protomaps", true, []).disabled).toBe(
        false,
      );
    }
    // A clip of another layer, or the height clip saved at z15 alone, is none.
    expect(
      terrainSwitch("slope", true, "protomaps", false, [saved[0]!]).disabled,
    ).toBe(true);
    expect(
      terrainSwitch("hillshade", true, "protomaps", false, [
        clip("dem-region", "nsw-5m", 15),
      ]).disabled,
    ).toBe(true);
  });
});

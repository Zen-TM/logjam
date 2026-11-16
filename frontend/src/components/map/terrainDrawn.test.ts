import { NSW_REGION, SIM_NZ } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { terrainDrawn } from "./terrainDrawn";

const on = {
  contours: true,
  coverage: true,
  fire: true,
  slope: true,
  land: true,
  hillshade: true,
};

describe("terrainDrawn", () => {
  // Mutation: draw Coverage with the stored carrier (`carrier`) in place of
  // `coverageCarrierHere(region, carrier)`, and over a region that does not
  // list it the map adds a Coverage layer filtered to a network it has no
  // data for.
  it("draws Coverage only with a carrier the region lists", () => {
    const home = terrainDrawn(on, "protomaps", NSW_REGION, "optus");
    expect(home.shown.coverage).toBe(true);
    expect(home.carrier).toBe("optus");
    const away = terrainDrawn(on, "protomaps", SIM_NZ, "optus");
    expect(away.shown.coverage).toBe(false);
    expect(away.carrier).toBeNull();
    expect(terrainDrawn(on, "protomaps", SIM_NZ, "simone").shown.coverage).toBe(
      true,
    );
    expect(terrainDrawn(on, "protomaps", null, "optus").shown.coverage).toBe(
      false,
    );
  });

  // Mutation: draw Coverage whenever a carrier is picked, ignoring
  // `layers.coverage`, and an off Coverage switch draws once a carrier is
  // picked.
  it("keeps every switch's own say, and the basemap's over contours and hillshade", () => {
    const off = { ...on, coverage: false, fire: false, land: false };
    const shown = terrainDrawn(off, "protomaps", NSW_REGION, "optus").shown;
    expect(shown).toMatchObject({ coverage: false, fire: false, land: false });
    expect(shown).toMatchObject({
      contours: true,
      slope: true,
      hillshade: true,
    });
    expect(
      terrainDrawn(on, "six-topo", NSW_REGION, "optus").shown.contours,
    ).toBe(false);
    expect(
      terrainDrawn(on, "six-imagery", NSW_REGION, "optus").shown.hillshade,
    ).toBe(false);
  });
});

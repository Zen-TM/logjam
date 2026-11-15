import {
  FIRE_MIN_ZOOM,
  fireColor,
  fireEdgeOpacity,
  fireFillOpacity,
  NSW_REGION,
  zoomFadeIn,
  SIM_NZ,
} from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { fireLayerSpecs } from "./fireLayers";
import { fireEdgeLayer, fireFillLayer } from "./layerOrder";
import { terrainEntries } from "./terrainEntries";

const NSW_FIRE = NSW_REGION.terrain.fire;
const NOV_2026 = new Date(2026, 10, 7);

describe("the Fire history layers", () => {
  // Mutation: write a colour, opacity or zoom into the layer by hand instead
  // of shared's ramp, and Logjam Web's tint drifts from Logjam GPS's.
  it("are painted by exactly shared's ramp, from its source layer and zoom", () => {
    const [fill, edge] = fireLayerSpecs(
      NSW_REGION,
      "topo-src-nswfire",
      NOV_2026,
    )!;
    expect(fill).toMatchObject({
      id: fireFillLayer(NSW_REGION),
      type: "fill",
      source: "topo-src-nswfire",
      "source-layer": NSW_FIRE.sourceLayer,
      minzoom: FIRE_MIN_ZOOM,
      paint: {
        "fill-color": fireColor(NSW_FIRE, NOV_2026),
        "fill-opacity": zoomFadeIn(
          FIRE_MIN_ZOOM,
          fireFillOpacity(NSW_FIRE, NOV_2026),
        ),
      },
    });
    expect(edge).toMatchObject({
      id: fireEdgeLayer(NSW_REGION),
      type: "line",
      source: "topo-src-nswfire",
      "source-layer": NSW_FIRE.sourceLayer,
      minzoom: FIRE_MIN_ZOOM,
      paint: {
        "line-color": fireColor(NSW_FIRE, NOV_2026),
        "line-width": 1,
        "line-opacity": zoomFadeIn(
          FIRE_MIN_ZOOM,
          fireEdgeOpacity(NSW_FIRE, NOV_2026),
        ),
      },
    });
  });

  // Mutation: list the edge before the tint, and the tint paints over the
  // boundary it should sit under.
  it("puts the tint under its edge", () => {
    expect(
      fireLayerSpecs(NSW_REGION, "s", NOV_2026)!.map((layer) => layer.id),
    ).toEqual([fireFillLayer(NSW_REGION), fireEdgeLayer(NSW_REGION)]);
  });

  // Mutation: credit the source with anything but NSW_FIRE's own line, and
  // the map's attribution drops a CC BY term of the data.
  it("credit the data on the map, by its CC BY licence", () => {
    expect(terrainEntries(NSW_REGION, []).fire?.attribution).toBe(
      NSW_FIRE.creditHtml,
    );
    expect(NSW_FIRE.creditHtml).toContain("NPWS Fire History");
    expect(NSW_FIRE.creditHtml).toContain("CC BY 4.0");
  });

  // Mutation: read NSW's archive whatever the region (or build layers for a
  // region with none), and a map over another region draws NSW's fire fields
  // from its source.
  it("are the region's own, and none where it has no fire archive", () => {
    const [fill] = fireLayerSpecs(SIM_NZ, "topo-src-simnzfire", NOV_2026)!;
    expect(fill).toMatchObject({
      id: fireFillLayer(SIM_NZ),
      "source-layer": SIM_NZ.terrain.fire!.sourceLayer,
      paint: {
        "fill-color": fireColor(SIM_NZ.terrain.fire!, NOV_2026),
        "fill-opacity": zoomFadeIn(
          FIRE_MIN_ZOOM,
          fireFillOpacity(SIM_NZ.terrain.fire!, NOV_2026),
        ),
      },
    });
    expect(fill.id).not.toBe(fireFillLayer(NSW_REGION));
    expect(fill.paint?.["fill-color"]).not.toEqual(
      fireColor(NSW_FIRE, NOV_2026),
    );
    expect(
      fireLayerSpecs({ ...SIM_NZ, terrain: {} }, "s", NOV_2026),
    ).toBeNull();
  });
});

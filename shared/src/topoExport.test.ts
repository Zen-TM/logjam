import { describe, it, expect } from "vitest";
import { TOPO_LAYERS } from "./topoSettings";
import { RASTER_LAYERS, VECTOR_LAYERS } from "./topoExport";
import { VALID_GEOPDF_OVERLAY_NAMES } from "./geoPdfConfig";
import { TOPO_OVERLAY_SOURCE } from "./geoPdfBaseLayers";

// ARCH-010: everything TS-side derives from the canonical TOPO_LAYERS list.
// Most of the guarantee is compile-time (TopoLayerKey and the
// TOPO_OVERLAY_SOURCE record are typed off the list); these pin the runtime
// derivations.

describe("TOPO_LAYERS derivations stay consistent", () => {
  const allNames = TOPO_LAYERS.map((l) => l.name);

  it("RASTER_LAYERS ∪ VECTOR_LAYERS covers every layer exactly once", () => {
    const union = [...RASTER_LAYERS, ...VECTOR_LAYERS];
    expect(union.sort()).toEqual([...allNames].sort());
    const overlap = RASTER_LAYERS.filter((l) =>
      (VECTOR_LAYERS as string[]).includes(l),
    );
    expect(overlap).toEqual([]);
  });

  it("the GeoPDF overlay allowlist matches the layer list", () => {
    expect([...VALID_GEOPDF_OVERLAY_NAMES].sort()).toEqual(
      [...allNames].sort(),
    );
  });

  it("every layer has an attribution source mapping", () => {
    expect(Object.keys(TOPO_OVERLAY_SOURCE).sort()).toEqual(
      [...allNames].sort(),
    );
  });

  it("layer names are unique", () => {
    expect(new Set(allNames).size).toBe(allNames.length);
  });
});

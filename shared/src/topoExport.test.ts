import { describe, it, expect } from "vitest";
import { TOPO_LAYERS } from "./topoSettings";
import {
  RASTER_LAYERS,
  VECTOR_LAYERS,
  validateExportRequest,
  type ExportFormat,
} from "./topoExport";
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

describe("validateExportRequest", () => {
  const raster = RASTER_LAYERS[0];
  const vector = VECTOR_LAYERS[0];

  it("rejects a raster layer for a vector-only format (geojson)", () => {
    const result = validateExportRequest({
      format: "geojson",
      bundling: "per-layer",
      layers: [raster],
    });
    expect(result).toEqual({
      ok: false,
      error: "GeoJSON does not support raster layers",
    });
  });

  it("rejects a vector layer for a raster-only format (geotiff)", () => {
    const result = validateExportRequest({
      format: "geotiff",
      bundling: "composite",
      layers: [vector],
    });
    expect(result).toEqual({
      ok: false,
      error: "GeoTIFF does not support vector layers",
    });
  });

  it("rejects per-layer bundling for gpkg (inherently bundled)", () => {
    const result = validateExportRequest({
      format: "gpkg",
      bundling: "per-layer",
      layers: [raster, vector],
    });
    expect(result).toEqual({
      ok: false,
      error: "GeoPackage cannot be bundled per-layer",
    });
  });

  it("rejects composite bundling for geojson and gpx (no raster pyramid concept)", () => {
    expect(
      validateExportRequest({ format: "geojson", bundling: "composite", layers: [vector] }),
    ).toEqual({ ok: false, error: "GeoJSON cannot be composited" });

    expect(
      validateExportRequest({ format: "gpx", bundling: "composite", layers: ["features"] }),
    ).toEqual({ ok: false, error: "GPX cannot be composited" });
  });

  it("rejects an empty layers list", () => {
    const result = validateExportRequest({
      format: "mbtiles",
      bundling: "composite",
      layers: [],
    });
    expect(result).toEqual({ ok: false, error: "at least one layer is required" });
  });

  it("rejects an unknown format", () => {
    const result = validateExportRequest({
      format: "kmz" as unknown as ExportFormat,
      bundling: "composite",
      layers: [raster],
    });
    expect(result).toEqual({ ok: false, error: "unknown format: kmz" });
  });

  it("accepts mbtiles with mixed raster/vector layers and composite bundling", () => {
    expect(
      validateExportRequest({
        format: "mbtiles",
        bundling: "composite",
        layers: [raster, vector],
      }),
    ).toEqual({ ok: true });
  });

  it("accepts gpx with the features layer and per-layer bundling", () => {
    expect(
      validateExportRequest({
        format: "gpx",
        bundling: "per-layer",
        layers: ["features"],
      }),
    ).toEqual({ ok: true });
  });
});

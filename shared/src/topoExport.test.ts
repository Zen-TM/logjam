import { describe, it, expect } from "vitest";
import { TOPO_LAYERS, RASTER_TEMPLATE_DEFAULTS, cloneRasterTemplateSettings } from "./topoSettings";
import {
  RASTER_LAYERS,
  VECTOR_LAYERS,
  AUTO_EXPORT_DEFAULTS,
  isLayerEligibleForFormat,
  producedLayers,
  reconcileExportSelection,
  validateAutoExportSettings,
  validateExportRequest,
  type ExportFormat,
  type TopoLayerKey,
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

  // TOPOEXP-1: GPX is features-only — the worker has no contour path.
  it("rejects contours for gpx (features-only allowlist)", () => {
    expect(
      validateExportRequest({
        format: "gpx",
        bundling: "per-layer",
        layers: ["features", "contours"],
      }),
    ).toEqual({ ok: false, error: "GPX does not support the Contours layer" });
  });
});

describe("isLayerEligibleForFormat", () => {
  it("gpx allows only the features layer", () => {
    expect(isLayerEligibleForFormat("gpx", "features")).toBe(true);
    expect(isLayerEligibleForFormat("gpx", "contours")).toBe(false);
    expect(isLayerEligibleForFormat("gpx", "hillshade")).toBe(false);
  });

  it("mirrors the raster/vector gates for unrestricted formats", () => {
    expect(isLayerEligibleForFormat("geotiff", "hillshade")).toBe(true);
    expect(isLayerEligibleForFormat("geotiff", "contours")).toBe(false);
    expect(isLayerEligibleForFormat("geojson", "contours")).toBe(true);
    expect(isLayerEligibleForFormat("geojson", "slope")).toBe(false);
    expect(isLayerEligibleForFormat("mbtiles", "contours")).toBe(true);
  });
});

describe("producedLayers", () => {
  it("returns every layer when all slices are enabled (the defaults)", () => {
    expect(producedLayers(RASTER_TEMPLATE_DEFAULTS).sort()).toEqual(
      TOPO_LAYERS.map((l) => l.name).sort(),
    );
  });

  it("omits a layer whose slice is disabled", () => {
    const s = cloneRasterTemplateSettings(RASTER_TEMPLATE_DEFAULTS);
    s.vegetation.enabled = false;
    s.contours.enabled = false;
    const out = producedLayers(s);
    expect(out).not.toContain("vegetation");
    expect(out).not.toContain("contours");
    expect(out).toContain("hillshade");
  });

  it("returns an empty list when every slice is disabled", () => {
    const s = cloneRasterTemplateSettings(RASTER_TEMPLATE_DEFAULTS);
    s.hillshade.enabled = false;
    s.vegetation.enabled = false;
    s.slope.enabled = false;
    s.contours.enabled = false;
    s.features.enabled = false;
    expect(producedLayers(s)).toEqual([]);
  });
});

describe("reconcileExportSelection", () => {
  const all = new Set<TopoLayerKey>(TOPO_LAYERS.map((l) => l.name));

  it("drops layers that are not available", () => {
    const out = reconcileExportSelection(
      { format: "mbtiles", bundling: "composite", layers: ["hillshade", "contours"] },
      new Set<TopoLayerKey>(["hillshade"]),
    );
    expect(out.layers).toEqual(["hillshade"]);
  });

  it("drops layers not eligible for the format (raster for geojson)", () => {
    const out = reconcileExportSelection(
      { format: "geojson", bundling: "per-layer", layers: ["hillshade", "contours"] },
      all,
    );
    expect(out.layers).toEqual(["contours"]);
  });

  it("drops contours for gpx (features-only allowlist)", () => {
    const out = reconcileExportSelection(
      { format: "gpx", bundling: "per-layer", layers: ["contours", "features"] },
      all,
    );
    expect(out.layers).toEqual(["features"]);
    // Fallback when the selection empties out picks only the allowlist.
    const fallback = reconcileExportSelection(
      { format: "gpx", bundling: "per-layer", layers: ["contours"] },
      all,
    );
    expect(fallback.layers).toEqual(["features"]);
  });

  it("falls back to all available+eligible layers when the selection empties out", () => {
    const out = reconcileExportSelection(
      { format: "geotiff", bundling: "composite", layers: ["contours"] }, // vector, n/a for geotiff
      all,
    );
    // geotiff is raster-only → falls back to the raster layers.
    expect(out.layers.sort()).toEqual(["hillshade", "slope", "vegetation"]);
  });

  it("coerces bundling to a legal value for the format", () => {
    // gpkg cannot be per-layer → composite.
    expect(
      reconcileExportSelection(
        { format: "gpkg", bundling: "per-layer", layers: ["hillshade"] },
        all,
      ).bundling,
    ).toBe("composite");
    // geojson cannot composite → per-layer.
    expect(
      reconcileExportSelection(
        { format: "geojson", bundling: "composite", layers: ["contours"] },
        all,
      ).bundling,
    ).toBe("per-layer");
  });

  it("is idempotent", () => {
    const once = reconcileExportSelection(
      { format: "geojson", bundling: "composite", layers: ["hillshade", "contours"] },
      all,
    );
    const twice = reconcileExportSelection(once, all);
    expect(twice).toEqual(once);
  });
});

describe("validateAutoExportSettings", () => {
  it("accepts the defaults", () => {
    const r = validateAutoExportSettings(AUTO_EXPORT_DEFAULTS);
    expect(r.ok).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(validateAutoExportSettings(null).ok).toBe(false);
    expect(validateAutoExportSettings([]).ok).toBe(false);
  });

  it("rejects an unknown format", () => {
    const r = validateAutoExportSettings({
      enabled: true,
      format: "kmz",
      bundling: "composite",
      layers: ["hillshade"],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an illegal format/layer combination (raster for geojson)", () => {
    const r = validateAutoExportSettings({
      enabled: true,
      format: "geojson",
      bundling: "per-layer",
      layers: ["hillshade"],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown layer name", () => {
    const r = validateAutoExportSettings({
      enabled: false,
      format: "mbtiles",
      bundling: "composite",
      layers: ["bogus"],
    });
    expect(r.ok).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { parseTrackGeoJSON } from "./trackGeo";

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="test">
  <trk><name>Test</name><trkseg>
    <trkpt lat="-33.70" lon="150.30"></trkpt>
    <trkpt lat="-33.71" lon="150.31"></trkpt>
  </trkseg></trk>
</gpx>`;

const KML = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>
  <LineString><coordinates>150.30,-33.70 150.31,-33.71</coordinates></LineString>
</Placemark></Document></kml>`;

const GEOJSON = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Imported" },
      geometry: {
        type: "LineString",
        coordinates: [
          [150.3, -33.7],
          [150.31, -33.71],
        ],
      },
    },
    { type: "Feature", properties: {}, geometry: null },
  ],
});

describe("parseTrackGeoJSON", () => {
  it("parses GPX into a LineString feature tagged with colour + canyonId", () => {
    const fc = parseTrackGeoJSON(GPX, "#e6194b", { canyonId: "canyon-1" });
    expect(fc.type).toBe("FeatureCollection");
    const line = fc.features.find((f) => f.geometry.type === "LineString");
    expect(line).toBeTruthy();
    expect(line?.properties?.color).toBe("#e6194b");
    expect(line?.properties?.canyonId).toBe("canyon-1");
  });

  it("parses KML into a LineString feature tagged with colour + canyonId", () => {
    const fc = parseTrackGeoJSON(KML, "#3cb44b", { canyonId: "canyon-2" });
    const line = fc.features.find((f) => f.geometry.type === "LineString");
    expect(line).toBeTruthy();
    expect(line?.properties?.color).toBe("#3cb44b");
    expect(line?.properties?.canyonId).toBe("canyon-2");
  });

  it("parses a GeoJSON FeatureCollection tagged with colour + mediaId", () => {
    const fc = parseTrackGeoJSON(GEOJSON, "#42d4f4", { mediaId: "media-1" });
    const line = fc.features.find((f) => f.geometry.type === "LineString");
    expect(line).toBeTruthy();
    expect(line?.properties?.color).toBe("#42d4f4");
    expect(line?.properties?.mediaId).toBe("media-1");
    // A feature with no geometry is dropped, not rendered as a hole.
    expect(fc.features).toHaveLength(1);
  });

  it("wraps a bare GeoJSON geometry into a stamped feature", () => {
    const fc = parseTrackGeoJSON(
      '{"type":"LineString","coordinates":[[150.3,-33.7],[150.31,-33.71]]}',
      null,
      { mediaId: "media-2" },
    );
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties?.mediaId).toBe("media-2");
  });

  it("throws on unparseable JSON rather than returning an empty collection", () => {
    expect(() => parseTrackGeoJSON("{ not json", null, { mediaId: "m" })).toThrow(
      /not valid GeoJSON/,
    );
    expect(() => parseTrackGeoJSON('{"type":"Nope"}', null, { mediaId: "m" })).toThrow(
      /not valid GeoJSON/,
    );
  });

  it("throws on JSON that is not GeoJSON at all", () => {
    expect(() => parseTrackGeoJSON('{"hello":"world"}', null, { mediaId: "m" })).toThrow(
      /not valid GeoJSON/,
    );
  });

  it("throws on an unrecognised root element", () => {
    expect(() => parseTrackGeoJSON("<foo></foo>", null, { canyonId: "c" })).toThrow(
      /Unrecognised track format/,
    );
  });
});

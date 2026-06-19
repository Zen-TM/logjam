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

describe("parseTrackGeoJSON", () => {
  it("parses GPX into a LineString feature tagged with colour + canyonId", () => {
    const fc = parseTrackGeoJSON(GPX, "#e6194b", "canyon-1");
    expect(fc.type).toBe("FeatureCollection");
    const line = fc.features.find((f) => f.geometry.type === "LineString");
    expect(line).toBeTruthy();
    expect(line?.properties?.color).toBe("#e6194b");
    expect(line?.properties?.canyonId).toBe("canyon-1");
  });

  it("parses KML into a LineString feature tagged with colour + canyonId", () => {
    const fc = parseTrackGeoJSON(KML, "#3cb44b", "canyon-2");
    const line = fc.features.find((f) => f.geometry.type === "LineString");
    expect(line).toBeTruthy();
    expect(line?.properties?.color).toBe("#3cb44b");
    expect(line?.properties?.canyonId).toBe("canyon-2");
  });

  it("throws on an unrecognised root element", () => {
    expect(() => parseTrackGeoJSON("<foo></foo>", null, "c")).toThrow(
      /Unrecognised track format/,
    );
  });
});

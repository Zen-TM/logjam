import { describe, expect, it } from "vitest";

import { classifyIncomingBytes, syntheticNameFor } from "./incomingIntent";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("classifyIncomingBytes", () => {
  it("detects PDF by magic", () => {
    expect(classifyIncomingBytes(bytes("%PDF-1.7\n…"))).toBe("pdf");
  });

  it("detects KMZ (zip) by magic", () => {
    expect(classifyIncomingBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe(
      "kmz",
    );
  });

  it("detects GPX and KML by XML root element, past the prolog", () => {
    expect(
      classifyIncomingBytes(
        bytes('<?xml version="1.0"?>\n<!-- c -->\n<gpx version="1.1">'),
      ),
    ).toBe("gpx");
    expect(
      classifyIncomingBytes(
        bytes('<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2">'),
      ),
    ).toBe("kml");
  });

  it("detects GeoJSON by leading brace", () => {
    expect(classifyIncomingBytes(bytes('  {"type":"FeatureCollection"}'))).toBe(
      "geojson",
    );
  });

  it("rejects unknown content and tiny buffers", () => {
    expect(classifyIncomingBytes(bytes("hello world"))).toBeNull();
    expect(classifyIncomingBytes(bytes("<html><body>no</body></html>"))).toBeNull();
    expect(classifyIncomingBytes(new Uint8Array([1, 2]))).toBeNull();
  });

  it("synthetic names end in the parser-dispatching extension", () => {
    expect(syntheticNameFor("gpx")).toMatch(/\.gpx$/);
    expect(syntheticNameFor("kmz")).toMatch(/\.kmz$/);
  });
});

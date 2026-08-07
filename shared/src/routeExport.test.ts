import { describe, it, expect } from "vitest";

import { routeToGpx, routeToKml, routeExportFilename } from "./routeExport.js";
import { parseVectorImport } from "./vectorImport.js";
import type { RoutePoint } from "./routeValidation.js";

// Synthetic coordinates — never a real canyon line in a committed test.
const LINE: RoutePoint[] = [
  [150.4, -33.5],
  [150.41, -33.51],
  [150.42, -33.52],
];

describe("routeToGpx", () => {
  it("writes a <rte>, not a <trk> — a drawn route is not a recording", () => {
    const gpx = routeToGpx("Approach", LINE);
    expect(gpx).toContain("<rte>");
    expect(gpx).not.toContain("<trk>");
    // The old export stamped every point 1970-01-01, which reads as a real
    // recording in every other GPX tool.
    expect(gpx).not.toContain("<time>");
  });

  it("round-trips through our own importer as one line", () => {
    const result = parseVectorImport("route.gpx", routeToGpx("Approach", LINE));
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    const lines = result.features.filter((f) => f.geometry.type === "LineString");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.geometry.coordinates).toHaveLength(3);
  });

  it("escapes XML in the name", () => {
    expect(routeToGpx('Bell & "Claustral" <fast>', LINE)).toContain(
      "<name>Bell &amp; &quot;Claustral&quot; &lt;fast&gt;</name>",
    );
  });
});

describe("routeToKml", () => {
  it("emits one LineString of lon,lat pairs", () => {
    const kml = routeToKml("Exit", LINE);
    expect(kml).toContain("<LineString><coordinates>150.400000,-33.500000");
  });

  it("round-trips through our own importer", () => {
    const result = parseVectorImport("route.kml", routeToKml("Exit", LINE));
    expect("error" in result).toBe(false);
  });
});

describe("routeExportFilename", () => {
  it("strips path separators and traversal", () => {
    // Separators become spaces and the leading dots are trimmed, so nothing
    // that reaches the filesystem can still read as a path.
    expect(routeExportFilename("../../etc/passwd", "gpx")).toBe("etc passwd.gpx");
    expect(routeExportFilename("a/b\\c", "kml")).toBe("a b c.kml");
  });

  it("never returns a name that is only an extension", () => {
    expect(routeExportFilename("", "gpx")).toBe("route.gpx");
    expect(routeExportFilename("   ", "gpx")).toBe("route.gpx");
    expect(routeExportFilename("...", "gpx")).toBe("route.gpx");
  });

  it("keeps ordinary names intact", () => {
    expect(routeExportFilename("Claustral exit", "gpx")).toBe("Claustral exit.gpx");
  });
});

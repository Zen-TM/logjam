import type { TCanyon } from "./canyonUtils";

export type TExportFormat = "gpx" | "kml" | "geojson";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function descriptionText(c: TCanyon): string {
  const parts: string[] = [];
  if (c.altNames.length > 0) parts.push(`Also known as: ${c.altNames.join(", ")}`);
  if (c.vGrade != null) parts.push(`V-grade: ${c.vGrade}`);
  if (c.aGrade != null) parts.push(`A-grade: ${c.aGrade}`);
  if (c.commitment != null) parts.push(`Commitment: ${c.commitment}`);
  if (c.numAbseils != null) parts.push(`Abseils: ${c.numAbseils}`);
  if (c.longestAbseil != null) parts.push(`Longest abseil: ${c.longestAbseil}m`);
  if (c.hours != null) parts.push(`Duration: ${c.hours}h`);
  if (c.quality != null) parts.push(`Quality: ${c.quality}`);
  if (c.notes) parts.push(`Notes: ${c.notes}`);
  return parts.join("\n");
}

function filenameSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function buildFilename(canyons: TCanyon[], ext: string): string {
  if (canyons.length === 1) {
    return `logjam-${filenameSlug(canyons[0].name)}.${ext}`;
  }
  return `logjam-canyons-${dateStamp()}.${ext}`;
}

function canyonsToGpx(canyons: TCanyon[]): Blob {
  const wpts = canyons
    .map((c) => {
      const desc = descriptionText(c);
      return [
        `  <wpt lat="${c.latitude}" lon="${c.longitude}">`,
        `    <name>${escapeXml(c.name)}</name>`,
        desc ? `    <desc>${escapeXml(desc)}</desc>` : "",
        `    <time>${c.updatedAt}</time>`,
        `  </wpt>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="Logjam" xmlns="http://www.topografix.com/GPX/1/1">`,
    wpts,
    `</gpx>`,
  ].join("\n");

  return new Blob([xml], { type: "application/gpx+xml" });
}

function canyonsToKml(canyons: TCanyon[]): Blob {
  const placemarks = canyons
    .map((c) => {
      const desc = descriptionText(c);
      return [
        `  <Placemark>`,
        `    <name>${escapeXml(c.name)}</name>`,
        desc ? `    <description><![CDATA[${desc}]]></description>` : "",
        `    <Point><coordinates>${c.longitude},${c.latitude},0</coordinates></Point>`,
        `  </Placemark>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<kml xmlns="http://www.opengis.net/kml/2.2">`,
    `<Document>`,
    placemarks,
    `</Document>`,
    `</kml>`,
  ].join("\n");

  return new Blob([xml], { type: "application/vnd.google-earth.kml+xml" });
}

function canyonsToGeoJson(canyons: TCanyon[]): Blob {
  const features = canyons.map((c) => {
    const { latitude, longitude, ...props } = c;
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [longitude, latitude] },
      properties: props,
    };
  });

  const collection = { type: "FeatureCollection", features };
  return new Blob([JSON.stringify(collection, null, 2)], {
    type: "application/geo+json",
  });
}

export function buildCanyonExport(
  canyons: TCanyon[],
  format: TExportFormat,
): { blob: Blob; filename: string } {
  switch (format) {
    case "gpx":
      return { blob: canyonsToGpx(canyons), filename: buildFilename(canyons, "gpx") };
    case "kml":
      return { blob: canyonsToKml(canyons), filename: buildFilename(canyons, "kml") };
    case "geojson":
      return { blob: canyonsToGeoJson(canyons), filename: buildFilename(canyons, "geojson") };
  }
}

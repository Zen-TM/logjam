// Geometry out of a GeoPackage feature row: the GeoPackage binary header
// (GeoPackage 1.3 §2.1.3) and the standard WKB after it. Only what the flow
// network layer (topo/build_flow_network.py) writes is needed, LineString
// creeks and MultiPolygon basins, but both byte orders and every envelope size
// are read, because GDAL picks those per writer and version, not per layer.

export type Position = [number, number];

export type Geometry =
  | { type: "Point"; coordinates: Position | null }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

/** Bytes of envelope for each envelope indicator: none, xy, xyz, xym, xyzm. */
const ENVELOPE_BYTES = [0, 32, 48, 48, 64];

/**
 * Where the WKB starts in a GeoPackage geometry blob, or null when the header
 * flags it empty (an empty geometry may carry no WKB at all).
 */
function wkbOffset(blob: Uint8Array): number | null {
  if (blob.length < 8 || blob[0] !== 0x47 || blob[1] !== 0x50) {
    throw new Error("not a GeoPackage geometry blob");
  }
  const flags = blob[3]!;
  if (flags & 0b0010_0000) {
    throw new Error("extended GeoPackage geometry is not supported");
  }
  const envelope = ENVELOPE_BYTES[(flags >> 1) & 0b111];
  if (envelope === undefined) {
    throw new Error("GeoPackage geometry has an invalid envelope indicator");
  }
  if (flags & 0b0001_0000) return null;
  // The header's own byte order (bit 0) covers only srs_id and the envelope,
  // neither of which is needed: the layer's SRS is in gpkg_contents, and the
  // WKB says its own byte order.
  return 8 + envelope;
}

class WkbReader {
  private view: DataView;
  private littleEndian = true;
  constructor(
    blob: Uint8Array,
    public offset: number,
  ) {
    this.view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  }
  byteOrder() {
    const order = this.view.getUint8(this.offset);
    if (order > 1) throw new Error("WKB has an invalid byte order");
    this.littleEndian = order === 1;
    this.offset += 1;
  }
  uint32() {
    const value = this.view.getUint32(this.offset, this.littleEndian);
    this.offset += 4;
    return value;
  }
  double() {
    const value = this.view.getFloat64(this.offset, this.littleEndian);
    this.offset += 8;
    return value;
  }
}

/** Coordinates per vertex, and the 2D type, from an ISO or EWKB type code. */
function wkbType(code: number): { base: number; dimensions: number } {
  // EWKB keeps 2D codes and flags Z and M in the top bits; ISO adds 1000 for
  // Z, 2000 for M, 3000 for both. GDAL writes ISO, PostGIS-born files EWKB.
  const ewkbZ = (code & 0x80000000) !== 0;
  const ewkbM = (code & 0x40000000) !== 0;
  const iso = code & 0x0fffffff;
  const base = iso % 1000;
  const isoDims = Math.floor(iso / 1000);
  if (isoDims > 3) throw new Error("WKB has an unknown geometry type");
  const z = ewkbZ || isoDims === 1 || isoDims === 3;
  const m = ewkbM || isoDims === 2 || isoDims === 3;
  return { base, dimensions: 2 + (z ? 1 : 0) + (m ? 1 : 0) };
}

function readGeometry(reader: WkbReader): Geometry {
  reader.byteOrder();
  const code = reader.uint32();
  if (code & 0x20000000) reader.uint32(); // an EWKB SRID, which the layer has
  const { base, dimensions } = wkbType(code);
  const position = (): Position => {
    const x = reader.double();
    const y = reader.double();
    for (let extra = 2; extra < dimensions; extra++) reader.double();
    return [x, y];
  };
  const points = () => Array.from({ length: reader.uint32() }, position);
  const rings = () => Array.from({ length: reader.uint32() }, points);
  // Each part of a multi-geometry is a whole WKB geometry, byte order and all.
  const parts = <T>(type: Geometry["type"]): T[] =>
    Array.from({ length: reader.uint32() }, () => {
      const part = readGeometry(reader);
      if (part.type !== type) {
        throw new Error("WKB collection holds the wrong kind of part");
      }
      return part.coordinates as T;
    });

  switch (base) {
    case 1: {
      const p = position();
      // An empty point is written as NaN, NaN.
      return {
        type: "Point",
        coordinates: Number.isNaN(p[0]) && Number.isNaN(p[1]) ? null : p,
      };
    }
    case 2:
      return { type: "LineString", coordinates: points() };
    case 3:
      return { type: "Polygon", coordinates: rings() };
    case 5:
      return {
        type: "MultiLineString",
        coordinates: parts<Position[]>("LineString"),
      };
    case 6:
      return {
        type: "MultiPolygon",
        coordinates: parts<Position[][]>("Polygon"),
      };
    default:
      throw new Error("WKB geometry type is not supported");
  }
}

/** A GeoPackage geometry blob, decoded; null when it is empty. */
export function decodeGpkgGeometry(blob: Uint8Array): Geometry | null {
  const offset = wkbOffset(blob);
  if (offset === null) return null;
  return readGeometry(new WkbReader(blob, offset));
}

/** A creek's vertices; an empty or missing line has none. */
export function gpkgLineString(blob: Uint8Array): Position[] {
  const geometry = decodeGpkgGeometry(blob);
  if (geometry === null) return [];
  if (geometry.type === "LineString") return geometry.coordinates;
  // A writer that promotes every line to a multi-line: one part is the line.
  if (geometry.type === "MultiLineString" && geometry.coordinates.length <= 1)
    return geometry.coordinates[0] ?? [];
  throw new Error("GeoPackage geometry is not a line");
}

/** A basin's polygons, each a list of rings with the outer ring first. */
export function gpkgPolygons(blob: Uint8Array): Position[][][] {
  const geometry = decodeGpkgGeometry(blob);
  if (geometry === null) return [];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  if (geometry.type === "Polygon") return [geometry.coordinates];
  throw new Error("GeoPackage geometry is not a polygon");
}

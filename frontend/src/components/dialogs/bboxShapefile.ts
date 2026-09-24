import type { TBbox } from "../map/Map";

/**
 * The area a drawn box covers, in square kilometres — what the credit estimate
 * is projected from before a ZIP exists, and what the box is labelled with.
 */
export function bboxAreaKm2(bbox: TBbox): number {
  const R = 6371;
  const dLat = ((bbox.north - bbox.south) * Math.PI) / 180;
  const dLon = ((bbox.east - bbox.west) * Math.PI) / 180;
  const midLat = (((bbox.north + bbox.south) / 2) * Math.PI) / 180;
  return R * R * dLat * dLon * Math.cos(midLat);
}

/**
 * A single-polygon shapefile ZIP (WGS84) of a drawn box: the four standard
 * components (.shp, .shx, .dbf, .prj), which ELVIS's "Load File" takes as they
 * are. Pure, so the bytes can be checked without a browser.
 *
 * The shapefile binary format is hand-written here to avoid a dependency.
 * Reference: ESRI Shapefile Technical Description (July 1998).
 */
export function bboxShapefileZip(bbox: TBbox): Uint8Array<ArrayBuffer> {
  const { west, south, east, north } = bbox;

  // Ring: 5 points (closed), clockwise
  const ring: [number, number][] = [
    [west, south],
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];

  // ── .shp ────────────────────────────────────────────────────────────────
  // File header (100 bytes) + record header (8 bytes) + polygon content
  const numPoints = ring.length;
  // contentLength: size of record content in 16-bit words (per shapefile spec)
  //   shape type (Int32):        4 bytes =  2 words
  //   bbox (4 × Float64):       32 bytes = 16 words
  //   num parts (Int32):         4 bytes =  2 words
  //   num points (Int32):        4 bytes =  2 words
  //   parts[0] (Int32):          4 bytes =  2 words
  //   points (n × 2 × Float64): n×16 bytes = n×8 words
  const contentLength = 2 + 16 + 2 + 2 + 2 + numPoints * 8; // in 16-bit words
  const shpSize = 50 + 4 + contentLength; // in 16-bit words

  const shp = new DataView(new ArrayBuffer(shpSize * 2));
  let o = 0;

  // File header
  shp.setInt32(o, 9994, false);
  o += 4; // magic
  o += 20; // unused
  shp.setInt32(o, shpSize, false);
  o += 4; // file length (16-bit words)
  shp.setInt32(o, 1000, true);
  o += 4; // version
  shp.setInt32(o, 5, true);
  o += 4; // shape type: polygon
  shp.setFloat64(o, west, true);
  o += 8; // bbox
  shp.setFloat64(o, south, true);
  o += 8;
  shp.setFloat64(o, east, true);
  o += 8;
  shp.setFloat64(o, north, true);
  o += 8;
  o += 32; // Z/M ranges (zeros)

  // Record header
  shp.setInt32(o, 1, false);
  o += 4; // record number
  shp.setInt32(o, contentLength, false);
  o += 4; // content length (16-bit words)

  // Polygon record
  shp.setInt32(o, 5, true);
  o += 4; // shape type: polygon
  shp.setFloat64(o, west, true);
  o += 8;
  shp.setFloat64(o, south, true);
  o += 8;
  shp.setFloat64(o, east, true);
  o += 8;
  shp.setFloat64(o, north, true);
  o += 8;
  shp.setInt32(o, 1, true);
  o += 4; // num parts
  shp.setInt32(o, numPoints, true);
  o += 4; // num points
  shp.setInt32(o, 0, true);
  o += 4; // part 0 starts at index 0
  for (const [x, y] of ring) {
    shp.setFloat64(o, x, true);
    o += 8;
    shp.setFloat64(o, y, true);
    o += 8;
  }

  // ── .shx ────────────────────────────────────────────────────────────────
  const shx = new DataView(new ArrayBuffer(108));
  let sx = 0;
  shx.setInt32(sx, 9994, false);
  sx += 4;
  sx += 20;
  shx.setInt32(sx, 54, false);
  sx += 4; // file length: 50 header + 4 per record
  shx.setInt32(sx, 1000, true);
  sx += 4;
  shx.setInt32(sx, 5, true);
  sx += 4;
  shx.setFloat64(sx, west, true);
  sx += 8;
  shx.setFloat64(sx, south, true);
  sx += 8;
  shx.setFloat64(sx, east, true);
  sx += 8;
  shx.setFloat64(sx, north, true);
  sx += 8;
  sx += 32;
  shx.setInt32(sx, 50, false);
  sx += 4; // offset of record 1 (16-bit words)
  shx.setInt32(sx, contentLength, false); // content length of record 1

  // ── .dbf ────────────────────────────────────────────────────────────────
  // Minimal dBASE III+ with a single "name" field
  // Header: 32 (file header) + 32 (field descriptor) + 1 (terminator) = 65 bytes
  // Records: 1 record × (1 deletion flag + 10 char field) = 11 bytes
  // Total: 76 bytes
  const enc = new TextEncoder();
  const dbf = new Uint8Array(76);
  dbf[0] = 3; // version
  dbf[4] = 1; // num records (low byte)
  dbf[8] = 65; // header size in bytes (32 + 1×32 + 1)
  dbf[10] = 11; // record size (1 deletion flag + 10 chars)
  // Field descriptor at offset 32: NAME, type C, length 10
  dbf.set(enc.encode("NAME"), 32);
  dbf[32 + 11] = 67; // type 'C'
  dbf[32 + 16] = 10; // field length
  dbf[64] = 0x0d; // header terminator
  dbf[65] = 0x20; // deletion flag (space = not deleted)
  dbf.set(enc.encode("topo_area "), 66); // field value (10 chars, padded with space)

  // ── .prj ────────────────────────────────────────────────────────────────
  const prj = enc.encode(
    'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
      'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
  );

  // ── ZIP ─────────────────────────────────────────────────────────────────
  // Build a minimal ZIP manually (store, no compression)
  function zipEntry(name: string, data: Uint8Array, offset: number) {
    const nameBytes = enc.encode(name);
    // CRC-32
    let crc = 0xffffffff;
    for (const b of data) {
      crc ^= b;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(8, 0, true); // compression: store
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central dir signature
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); // offset of local header
    central.set(nameBytes, 46);

    return { local, central };
  }

  const files: { name: string; data: Uint8Array }[] = [
    { name: "topo_area.shp", data: new Uint8Array(shp.buffer) },
    { name: "topo_area.shx", data: new Uint8Array(shx.buffer) },
    { name: "topo_area.dbf", data: dbf },
    { name: "topo_area.prj", data: prj },
  ];

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let localOffset = 0;

  for (const f of files) {
    const { local, central } = zipEntry(f.name, f.data, localOffset);
    locals.push(local);
    centrals.push(central);
    localOffset += local.length;
  }

  const centralOffset = localOffset;
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);

  const total = [...locals, ...centrals, eocd].reduce(
    (s, a) => s + a.length,
    0,
  );
  const zip = new Uint8Array(total);
  let pos = 0;
  for (const a of [...locals, ...centrals, eocd]) {
    zip.set(a, pos);
    pos += a.length;
  }

  return zip;
}

/** Hands the ZIP to the browser as a download. */
export function downloadBboxShapefile(bbox: TBbox) {
  const blob = new Blob([bboxShapefileZip(bbox)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "topo_area.zip";
  link.click();
  URL.revokeObjectURL(url);
}


import { describe, expect, it } from "vitest";
import { bboxAreaKm2, bboxShapefileZip } from "./bboxShapefile";

const BLUE_MOUNTAINS = { west: 150.3, south: -33.75, east: 150.4, north: -33.65 };

/** Read a little-endian u32 at an offset. */
const u32 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer).getUint32(at, true);

describe("bboxAreaKm2", () => {
  it("measures a tenth of a degree near Sydney at about 103 km²", () => {
    // 0.1° of latitude is 11.1 km; 0.1° of longitude at 33.7°S is 9.2 km.
    expect(bboxAreaKm2(BLUE_MOUNTAINS)).toBeCloseTo(102.9, 0);
  });

  it("shrinks the same box of degrees towards the pole", () => {
    const polar = { ...BLUE_MOUNTAINS, south: -80.1, north: -80 };
    expect(bboxAreaKm2(polar)).toBeLessThan(bboxAreaKm2(BLUE_MOUNTAINS));
  });
});

describe("bboxShapefileZip", () => {
  // ELVIS takes the ZIP as it is: a component missing or a header written
  // wrong is refused there, not here, so the four names and the signatures are
  // the thing worth pinning.
  it("writes the four shapefile components ELVIS asks for", () => {
    const zip = bboxShapefileZip(BLUE_MOUNTAINS);
    const text = new TextDecoder().decode(zip);
    for (const name of ["topo_area.shp", "topo_area.shx", "topo_area.dbf", "topo_area.prj"]) {
      // Once as a local header, once in the central directory.
      expect(text.split(name)).toHaveLength(3);
    }
    expect(u32(zip, 0)).toBe(0x04034b50); // first local file header
    // End of central directory, with four entries in it.
    const eocd = zip.length - 22;
    expect(u32(zip, eocd)).toBe(0x06054b50);
    expect(new DataView(zip.buffer).getUint16(eocd + 10, true)).toBe(4);
  });

  it("carries the drawn box's own corners, not a fixed extent", () => {
    const other = bboxShapefileZip({ west: 151, south: -34, east: 151.1, north: -33.9 });
    expect(bboxShapefileZip(BLUE_MOUNTAINS)).not.toEqual(other);
  });
});

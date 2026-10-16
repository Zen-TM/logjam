import { describe, expect, it } from "vitest";
import {
  decodeGpkgGeometry,
  gpkgLineString,
  gpkgPolygons,
  type Position,
} from "./gpkgGeometry";

// Blobs built by hand, byte by byte, so the decoder is checked against the
// GeoPackage spec rather than against whatever GDAL wrote into the fixture.

class Bytes {
  private parts: number[] = [];
  constructor(private littleEndian: boolean) {}
  u8(...values: number[]) {
    this.parts.push(...values);
    return this;
  }
  u32(value: number) {
    const view = new DataView(new ArrayBuffer(4));
    view.setUint32(0, value, this.littleEndian);
    return this.u8(...new Uint8Array(view.buffer));
  }
  f64(value: number) {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value, this.littleEndian);
    return this.u8(...new Uint8Array(view.buffer));
  }
  order(littleEndian: boolean) {
    this.littleEndian = littleEndian;
    return this.u8(littleEndian ? 1 : 0);
  }
  done() {
    return new Uint8Array(this.parts);
  }
}

/** A header: "GP", version 0, flags, srs 4326, and `envelope` doubles. */
function header(
  bytes: Bytes,
  { envelope = 1, littleEndian = true, empty = false } = {},
) {
  const doubles = [0, 4, 6, 6, 8][envelope]!;
  bytes.u8(
    0x47,
    0x50,
    0,
    (littleEndian ? 1 : 0) | (envelope << 1) | (empty ? 0x10 : 0),
  );
  // The header's srs and envelope are in the header's byte order.
  const inHeader = new Bytes(littleEndian).u32(4326);
  for (let i = 0; i < doubles; i++) inHeader.f64(150 + i);
  return bytes.u8(...inHeader.done());
}

function lineBlob(
  line: Position[],
  {
    envelope = 1,
    headerLittle = true,
    wkbLittle = true,
    typeCode = 2,
    extraOrdinates = 0,
  } = {},
) {
  const bytes = header(new Bytes(true), {
    envelope,
    littleEndian: headerLittle,
  });
  const wkb = new Bytes(wkbLittle)
    .order(wkbLittle)
    .u32(typeCode)
    .u32(line.length);
  for (const [x, y] of line) {
    wkb.f64(x).f64(y);
    for (let i = 0; i < extraOrdinates; i++) wkb.f64(999);
  }
  return new Uint8Array([...bytes.done(), ...wkb.done()]);
}

const LINE: Position[] = [
  [150.31, -33.7],
  [150.32, -33.71],
  [150.33, -33.705],
];

describe("gpkgLineString", () => {
  // Mutation: ignore the envelope indicator (always skip 32 bytes) and every
  // case but envelope 1 goes red.
  it.each([0, 1, 2, 3, 4])("skips an envelope of indicator %i", (envelope) => {
    expect(gpkgLineString(lineBlob(LINE, { envelope }))).toEqual(LINE);
  });

  // Mutation: read the WKB in the header's byte order, or always little-endian.
  it("reads the WKB in its own byte order, whatever the header's", () => {
    for (const headerLittle of [true, false]) {
      for (const wkbLittle of [true, false]) {
        expect(
          gpkgLineString(lineBlob(LINE, { headerLittle, wkbLittle })),
        ).toEqual(LINE);
      }
    }
  });

  // Mutation: read two ordinates per vertex regardless of the type code.
  it("drops Z and M from ISO and EWKB lines", () => {
    expect(
      gpkgLineString(lineBlob(LINE, { typeCode: 1002, extraOrdinates: 1 })),
    ).toEqual(LINE);
    expect(
      gpkgLineString(lineBlob(LINE, { typeCode: 3002, extraOrdinates: 2 })),
    ).toEqual(LINE);
    expect(
      gpkgLineString(
        lineBlob(LINE, { typeCode: 0x80000002, extraOrdinates: 1 }),
      ),
    ).toEqual(LINE);
  });

  // Mutation: drop the empty-flag check and the decoder reads past the end.
  it("is empty when the header flags it empty", () => {
    const blob = header(new Bytes(true), { envelope: 0, empty: true }).done();
    expect(decodeGpkgGeometry(blob)).toBeNull();
    expect(gpkgLineString(blob)).toEqual([]);
  });

  it("refuses what is not a GeoPackage line", () => {
    expect(() =>
      gpkgLineString(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
    ).toThrow();
    const point = new Uint8Array([
      ...header(new Bytes(true)).done(),
      ...new Bytes(true).order(true).u32(1).f64(1).f64(2).done(),
    ]);
    expect(() => gpkgLineString(point)).toThrow();
  });
});

describe("gpkgPolygons", () => {
  const outer: Position[] = [
    [150, -34],
    [151, -34],
    [151, -33],
    [150, -33],
    [150, -34],
  ];
  const hole: Position[] = [
    [150.4, -33.6],
    [150.6, -33.6],
    [150.6, -33.4],
    [150.4, -33.6],
  ];

  function polygonWkb(rings: Position[][], littleEndian: boolean) {
    const wkb = new Bytes(littleEndian)
      .order(littleEndian)
      .u32(3)
      .u32(rings.length);
    for (const ring of rings) {
      wkb.u32(ring.length);
      for (const [x, y] of ring) wkb.f64(x).f64(y);
    }
    return wkb.done();
  }

  // Mutation: read a multipolygon's parts in the parent's byte order, and the
  // big-endian part goes red.
  it("reads a multipolygon whose parts differ in byte order", () => {
    const blob = new Uint8Array([
      ...header(new Bytes(true)).done(),
      ...new Bytes(true).order(true).u32(6).u32(2).done(),
      ...polygonWkb([outer, hole], true),
      ...polygonWkb([outer], false),
    ]);
    expect(gpkgPolygons(blob)).toEqual([[outer, hole], [outer]]);
  });

  it("takes a lone polygon as one", () => {
    const blob = new Uint8Array([
      ...header(new Bytes(true)).done(),
      ...polygonWkb([outer], true),
    ]);
    expect(gpkgPolygons(blob)).toEqual([[outer]]);
  });
});

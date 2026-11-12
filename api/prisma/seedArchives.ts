// Tiny real tile archives for the seeded topo jobs.
//
// A completed topo job is only believable with its PMTiles behind it: Logjam
// Web asks `/topo-jobs/completed-overlays` for a presigned URL per layer and
// draws what it finds there. These are the smallest archives that satisfy that,
// built the way the format says (PMTiles v3 spec) and read back by the `pmtiles`
// package in seedArchives.unit.test.ts. Nothing here is LiDAR-derived: the
// raster is a flat grey tile and the vector tile is one made-up line.
import { crc32, deflateSync } from "node:zlib";
import { zxyToTileId } from "pmtiles";

const MAX_LAT = 85.0511287798066;

/** The slippy-map tile holding a point at a zoom. */
export function tileAt(zoom: number, lon: number, lat: number) {
  const n = 2 ** zoom;
  const latRad = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return {
    z: zoom,
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
        n,
    ),
  };
}

/** [west, south, east, north] of a slippy-map tile. */
export function tileBounds(z: number, x: number, y: number) {
  const n = 2 ** z;
  const lon = (tx: number) => (tx / n) * 360 - 180;
  const lat = (ty: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)] as const;
}

/** A 256 x 256 8-bit greyscale PNG of one flat value. */
export function flatPng(grey: number): Buffer {
  const size = 256;
  // Each row is a filter byte (0: none) then its pixels.
  const rows = Buffer.alloc((size + 1) * size, grey);
  for (let y = 0; y < size; y++) rows[y * (size + 1)] = 0;
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(
      crc32(Buffer.concat([Buffer.from(type, "ascii"), data])),
      0,
    );
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const varint = (n: number): number[] => {
  const out: number[] = [];
  let v = n;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
};
const zigzag = (n: number) => (n << 1) ^ (n >> 31);
const field = (tag: number, bytes: number[]) => [
  tag,
  ...varint(bytes.length),
  ...bytes,
];

/** A Mapbox Vector Tile with one layer holding one line, in tile units (extent 4096). */
export function lineVectorTile(
  layer: string,
  line: [number, number][],
): Buffer {
  // MoveTo the first vertex, LineTo the rest; each coordinate is a zigzag delta.
  const geometry = [(1 & 7) | (1 << 3)];
  geometry.push(...varint(zigzag(line[0][0])), ...varint(zigzag(line[0][1])));
  geometry.push((2 & 7) | ((line.length - 1) << 3));
  for (let i = 1; i < line.length; i++) {
    geometry.push(
      ...varint(zigzag(line[i][0] - line[i - 1][0])),
      ...varint(zigzag(line[i][1] - line[i - 1][1])),
    );
  }
  const feature = [0x18, 2 /* LINESTRING */, ...field(0x22, geometry)];
  const body = [
    ...field(0x0a, [...Buffer.from(layer, "utf8")]),
    ...field(0x12, feature),
    0x28,
    ...varint(4096),
    0x78,
    2, // version
  ];
  return Buffer.from(field(0x1a, body));
}

export type PmtilesTileType = "mvt" | "png";

/**
 * A PMTiles v3 archive holding ONE tile, uncompressed throughout: a 127-byte
 * header, a one-entry root directory, `{}` metadata, then the tile.
 */
export function singleTilePmtiles(opts: {
  z: number;
  x: number;
  y: number;
  tile: Buffer;
  type: PmtilesTileType;
}): Buffer {
  const { z, x, y, tile } = opts;
  const tileId = zxyToTileId(z, x, y);
  // One entry: count, tile id, run length, length, offset + 1.
  const root = Buffer.from([
    ...varint(1),
    ...varint(tileId),
    ...varint(1),
    ...varint(tile.length),
    ...varint(1),
  ]);
  const metadata = Buffer.from("{}", "utf8");
  const [west, south, east, north] = tileBounds(z, x, y);
  const e7 = (deg: number) => Math.round(deg * 1e7);

  const rootOffset = 127;
  const metadataOffset = rootOffset + root.length;
  const tileOffset = metadataOffset + metadata.length;
  const header = Buffer.alloc(127);
  header.write("PMTiles", 0, "ascii");
  header[7] = 3;
  header.writeBigUInt64LE(BigInt(rootOffset), 8);
  header.writeBigUInt64LE(BigInt(root.length), 16);
  header.writeBigUInt64LE(BigInt(metadataOffset), 24);
  header.writeBigUInt64LE(BigInt(metadata.length), 32);
  header.writeBigUInt64LE(BigInt(tileOffset + tile.length), 40); // no leaf dirs
  header.writeBigUInt64LE(0n, 48);
  header.writeBigUInt64LE(BigInt(tileOffset), 56);
  header.writeBigUInt64LE(BigInt(tile.length), 64);
  header.writeBigUInt64LE(1n, 72); // addressed tiles
  header.writeBigUInt64LE(1n, 80); // tile entries
  header.writeBigUInt64LE(1n, 88); // tile contents
  header[96] = 1; // clustered
  header[97] = 1; // internal compression: none
  header[98] = 1; // tile compression: none
  header[99] = opts.type === "mvt" ? 1 : 2;
  header[100] = z;
  header[101] = z;
  header.writeInt32LE(e7(west), 102);
  header.writeInt32LE(e7(south), 106);
  header.writeInt32LE(e7(east), 110);
  header.writeInt32LE(e7(north), 114);
  header[118] = z;
  header.writeInt32LE(e7((west + east) / 2), 119);
  header.writeInt32LE(e7((south + north) / 2), 123);
  return Buffer.concat([header, root, metadata, tile]);
}

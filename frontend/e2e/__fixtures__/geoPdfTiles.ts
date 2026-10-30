// Made-up map data for the GeoPDF renderer's e2e: base tiles as PNG, and
// PMTiles archives (heights and slope as terrarium PNG, contours as vector
// tiles) around a generic point, built here so no network or archive is
// needed. Nothing is a real place or a user's data.
import { deflateSync, crc32 } from "node:zlib";
import { PbfWriter } from "pbf";
import { zxyToTileId } from "pmtiles";

/** An obviously generic point, inside the NSW coverage the renderer expects. */
export const CENTRE = { lat: -30, lon: 150 };

const lon2x = (lon: number, z: number) =>
  Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z,
  );
};

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(
    crc32(out.subarray(4, 8 + data.length)) >>> 0,
    8 + data.length,
  );
  return out;
}

/** A 256 x 256 RGBA PNG, every pixel from `pixel(i, j)`. */
export function png(
  pixel: (i: number, j: number) => [number, number, number, number],
) {
  const raw = Buffer.alloc(256 * (1 + 256 * 4));
  for (let j = 0; j < 256; j++) {
    const row = j * (1 + 256 * 4);
    for (let i = 0; i < 256; i++) {
      const [r, g, b, a] = pixel(i, j);
      raw.set([r, g, b, a], row + 1 + i * 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(256, 0);
  header.writeUInt32BE(256, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A base-layer tile: smooth colour waves in global pixel coordinates, so
 *  neighbours join and a scaling or offset fault shows as a shifted wave, while
 *  a one-level sampling difference stays one level (a hard edge would turn it
 *  into a large one). */
export function baseTilePng(z: number, x: number, y: number) {
  const wave = (g: number, period: number, phase: number) =>
    128 + 90 * Math.sin(g / period + phase);
  return png((i, j) => {
    const gx = x * 256 + i;
    const gy = y * 256 + j;
    return [
      wave(gx + gy, 41 * 2 ** (z - 16), 0),
      wave(gx - gy, 67 * 2 ** (z - 16), 2),
      wave(gy, 29 * 2 ** (z - 16), 4),
      255,
    ];
  });
}

// The made-up ground, in z15 pixel coordinates: hills with a steady tilt.
const SIZE_M = 4.1; // metres a z15 pixel spans, about
const height = (gx: number, gy: number) =>
  1500 +
  900 * Math.sin(gx / 230) * Math.cos(gy / 190) +
  300 * Math.sin((gx + gy) / 70);
const gradient = (gx: number, gy: number) => {
  const dx =
    (900 / 230) * Math.cos(gx / 230) * Math.cos(gy / 190) +
    (300 / 70) * Math.cos((gx + gy) / 70);
  const dy =
    (-900 / 190) * Math.sin(gx / 230) * Math.sin(gy / 190) +
    (300 / 70) * Math.cos((gx + gy) / 70);
  return Math.hypot(dx, dy);
};

/** Terrarium encoding: (R * 256 + G + B / 256) - 32768. */
const terrarium = (metres: number): [number, number, number, number] => {
  const v = metres + 32768;
  const whole = Math.floor(v);
  return [whole >> 8, whole & 255, Math.floor((v - whole) * 256), 255];
};

export const heightsPng = (x: number, y: number) =>
  png((i, j) => terrarium(height(x * 256 + i, y * 256 + j)));

/** Slope in whole degrees, as the statewide slope archive holds it (ADR 0039). */
export const slopePng = (x: number, y: number) =>
  png((i, j) =>
    terrarium(
      Math.min(
        89,
        Math.round(
          (Math.atan(gradient(x * 256 + i, y * 256 + j) / SIZE_M) * 180) /
            Math.PI,
        ),
      ),
    ),
  );

/** Contours as rings round the centre of z14 tile space: a vector tile with a
 *  `contours` layer, features carrying `elev`. */
export function contoursMvt(z: number, x: number, y: number): Buffer {
  const EXTENT = 4096;
  const cx = (lon2x(CENTRE.lon, z) + 0.5) * EXTENT;
  const cy = (lat2y(CENTRE.lat, z) + 0.5) * EXTENT;
  const elevs: number[] = [];
  for (let e = 650; e <= 1000; e += 10) elevs.push(e);
  const features = elevs.flatMap((elev) => {
    const r = (elev - 600) * 18;
    // Runs of the ring that lie in this tile, with a margin.
    const runs: [number, number][][] = [];
    let run: [number, number][] = [];
    for (let a = 0; a <= 360; a++) {
      const t = (a * Math.PI) / 180;
      const px = Math.round(cx + r * Math.cos(t) - x * EXTENT);
      const py = Math.round(cy + r * 0.8 * Math.sin(t) - y * EXTENT);
      const inside =
        px > -300 && px < EXTENT + 300 && py > -300 && py < EXTENT + 300;
      if (inside) run.push([px, py]);
      else if (run.length) {
        runs.push(run);
        run = [];
      }
    }
    if (run.length) runs.push(run);
    return runs.filter((r2) => r2.length >= 2).map((pts) => ({ elev, pts }));
  });
  const zig = (v: number) => (v << 1) ^ (v >> 31);
  const tile = new PbfWriter();
  tile.writeMessage(
    3,
    (_o, layer) => {
      layer.writeStringField(1, "contours");
      for (const f of features) {
        layer.writeMessage(
          2,
          (feat, pbf) => {
            pbf.writePackedVarint(2, [0, feat.elevIndex]);
            pbf.writeVarintField(3, 2);
            const g: number[] = [];
            let [lx, ly] = [0, 0];
            feat.pts.forEach(([px, py], k) => {
              if (k === 0) g.push((1 << 3) | 1);
              else if (k === 1) g.push(((feat.pts.length - 1) << 3) | 2);
              g.push(zig(px - lx), zig(py - ly));
              [lx, ly] = [px, py];
            });
            pbf.writePackedVarint(4, g);
          },
          { pts: f.pts, elevIndex: elevs.indexOf(f.elev) },
        );
      }
      layer.writeStringField(3, "elev");
      for (const e of elevs)
        layer.writeMessage(4, (v, pbf) => pbf.writeVarintField(5, v), e);
      layer.writeVarintField(5, EXTENT);
      layer.writeVarintField(15, 2);
    },
    null,
  );
  return Buffer.from(tile.finish());
}

type ArchiveTile = { z: number; x: number; y: number; data: Buffer };

function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 128) {
    out.push((n % 128) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}

/** A PMTiles v3 archive, uncompressed, one root directory. */
export function pmtiles(tiles: ArchiveTile[], tileType: 1 | 2): Buffer {
  const sorted = tiles
    .map((t) => ({ ...t, id: zxyToTileId(t.z, t.x, t.y) }))
    .sort((a, b) => a.id - b.id);
  let offset = 0;
  const entries = sorted.map((t) => {
    const e = { id: t.id, offset, length: t.data.length };
    offset += t.data.length;
    return e;
  });
  const dir: number[] = [...varint(entries.length)];
  let last = 0;
  for (const e of entries) {
    dir.push(...varint(e.id - last));
    last = e.id;
  }
  for (let i = 0; i < entries.length; i++) dir.push(...varint(1));
  for (const e of entries) dir.push(...varint(e.length));
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const prev = entries[i - 1];
    dir.push(
      ...varint(
        prev && e.offset === prev.offset + prev.length ? 0 : e.offset + 1,
      ),
    );
  }
  const root = Buffer.from(dir);
  const meta = Buffer.from("{}");
  const header = Buffer.alloc(127);
  header.write("PMTiles", 0, "ascii");
  header.writeUInt8(3, 7);
  const u64 = (v: number, at: number) => header.writeBigUInt64LE(BigInt(v), at);
  u64(127, 8); // root directory
  u64(root.length, 16);
  u64(127 + root.length, 24); // metadata
  u64(meta.length, 32);
  u64(0, 40); // leaf directories
  u64(0, 48);
  const dataAt = 127 + root.length + meta.length;
  u64(dataAt, 56);
  u64(offset, 64);
  u64(entries.length, 72);
  u64(entries.length, 80);
  u64(entries.length, 88);
  header.writeUInt8(1, 96); // clustered
  header.writeUInt8(1, 97); // internal compression: none
  header.writeUInt8(1, 98); // tile compression: none
  header.writeUInt8(tileType, 99);
  header.writeUInt8(Math.min(...sorted.map((t) => t.z)), 100);
  header.writeUInt8(Math.max(...sorted.map((t) => t.z)), 101);
  header.writeInt32LE(1_400_000_000, 102); // bounds: far wider than any tile here
  header.writeInt32LE(-400_000_000, 106);
  header.writeInt32LE(1_600_000_000, 110);
  header.writeInt32LE(-200_000_000, 114);
  return Buffer.concat([header, root, meta, ...sorted.map((t) => t.data)]);
}

/** A height archive whose every tile is bytes no decoder reads. */
export function unreadableHeights(): Buffer {
  const cx = lon2x(CENTRE.lon, 15);
  const cy = lat2y(CENTRE.lat, 15);
  const tiles: ArchiveTile[] = [];
  for (let y = cy - 7; y <= cy + 7; y++)
    for (let x = cx - 7; x <= cx + 7; x++)
      tiles.push({ z: 15, x, y, data: Buffer.from("not a png") });
  return pmtiles(tiles, 2);
}

/** The three statewide archives round CENTRE, built once. */
export function statewideArchives() {
  const tilesAt = (z: number, radius: number) => {
    const cx = lon2x(CENTRE.lon, z);
    const cy = lat2y(CENTRE.lat, z);
    const out: [number, number][] = [];
    for (let y = cy - radius; y <= cy + radius; y++)
      for (let x = cx - radius; x <= cx + radius; x++) out.push([x, y]);
    return out;
  };
  const z15 = tilesAt(15, 7);
  return {
    heights: pmtiles(
      z15.map(([x, y]) => ({ z: 15, x, y, data: heightsPng(x, y) })),
      2,
    ),
    slope: pmtiles(
      z15.map(([x, y]) => ({ z: 15, x, y, data: slopePng(x, y) })),
      2,
    ),
    contours: pmtiles(
      tilesAt(14, 3).map(([x, y]) => ({
        z: 14,
        x,
        y,
        data: contoursMvt(14, x, y),
      })),
      1,
    ),
  };
}

// Regenerates the fixture `src/pmtilesExtract.test.ts` checks the extractor
// against: a made-up archive, and what go-pmtiles' own `pmtiles extract` cuts
// from it.
//
// Run from the repo root, with the go-pmtiles that `api/Dockerfile` pins on
// PATH (`pmtiles version` says 1.31.2):
//   node shared/scripts/pmtiles-extract-fixture.mjs
//
// The archive is invented, not a map: each tile is three bytes, a counter, so
// a misplaced byte shows. It has enough tiles that go-pmtiles needs leaf
// directories, a block of identical "sea" tiles it stores as runs, and
// scattered duplicates it stores once.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PMTiles } from "pmtiles";

const OUT = new URL("../src/__fixtures__/pmtiles-extract/", import.meta.url);
const BOUNDS = { west: 149, south: -35, east: 152, north: -32 };
const MAXZOOM = 14;

/** The cuts checked, in `pmtiles extract`'s own arguments. */
export const CASES = [
  { name: "full depth", bbox: [150.2, -33.8, 150.6, -33.4], maxzoom: 14 },
  {
    name: "one zoom",
    bbox: [150.2, -33.8, 150.6, -33.4],
    minzoom: 13,
    maxzoom: 13,
  },
  {
    name: "across the sea",
    bbox: [149.2, -34.6, 149.7, -34.1],
    minzoom: 10,
    maxzoom: 14,
  },
  { name: "past the edge", bbox: [151.8, -32.3, 152.4, -31.7], maxzoom: 12 },
  // West edge exactly on a z14 tile line (x = 15000).
  {
    name: "edge on a tile line",
    bbox: [149.58984375, -33.5, 149.8, -33.3],
    maxzoom: 14,
  },
  { name: "outside", bbox: [140, -30, 140.5, -29.5], maxzoom: 14 },
];

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n),
  };
}

/** Every tile entry of an archive, read with the pmtiles package. */
export async function dumpArchive(bytes) {
  const source = {
    getKey: () => "archive",
    getBytes: async (offset, length) => ({
      data: bytes.buffer.slice(
        bytes.byteOffset + offset,
        bytes.byteOffset + offset + length,
      ),
    }),
  };
  const archive = new PMTiles(source);
  const header = await archive.getHeader();
  const entries = [];
  const walk = async (offset, length) => {
    for (const e of await archive.cache.getDirectory(
      source,
      offset,
      length,
      header,
    )) {
      if (e.runLength === 0)
        await walk(header.leafDirectoryOffset + e.offset, e.length);
      else entries.push([e.tileId, e.offset, e.length, e.runLength]);
    }
  };
  await walk(header.rootDirectoryOffset, header.rootDirectoryLength);
  const tileData = Buffer.from(
    bytes.subarray(
      header.tileDataOffset,
      header.tileDataOffset + header.tileDataLength,
    ),
  ).toString("hex");
  const keep = [
    "numAddressedTiles",
    "numTileEntries",
    "numTileContents",
    "clustered",
    "internalCompression",
    "tileCompression",
    "tileType",
    "minZoom",
    "maxZoom",
    "minLon",
    "minLat",
    "maxLon",
    "maxLat",
    "centerZoom",
    "centerLon",
    "centerLat",
    "tileDataLength",
    "jsonMetadataLength",
  ];
  return {
    header: Object.fromEntries(keep.map((k) => [k, header[k]])),
    leafDirectories: header.leafDirectoryLength > 0,
    entries,
    tileData,
  };
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), "pmtiles-fixture-"));
  const mbtiles = join(work, "fixture.mbtiles");
  const db = new DatabaseSync(mbtiles);
  db.exec(
    "CREATE TABLE metadata (name text, value text);" +
      "CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);",
  );
  const meta = db.prepare("INSERT INTO metadata VALUES (?, ?)");
  for (const [k, v] of Object.entries({
    name: "pmtiles-extract fixture",
    format: "png",
    minzoom: "0",
    maxzoom: String(MAXZOOM),
    bounds: `${BOUNDS.west},${BOUNDS.south},${BOUNDS.east},${BOUNDS.north}`,
  }))
    meta.run(k, v);
  const insert = db.prepare("INSERT INTO tiles VALUES (?, ?, ?, ?)");
  let counter = 0;
  db.exec("BEGIN");
  for (let z = 0; z <= MAXZOOM; z++) {
    const tl = lonLatToTile(BOUNDS.west, BOUNDS.north, z);
    const br = lonLatToTile(BOUNDS.east, BOUNDS.south, z);
    const seaEdge = lonLatToTile(149.5, 0, z).x;
    for (let x = tl.x; x <= br.x; x++) {
      for (let y = tl.y; y <= br.y; y++) {
        let data;
        if (z >= 8 && x < seaEdge) data = Buffer.from("SEA");
        else if ((x + y) % 50 === 0) data = Buffer.from("DUP");
        else {
          counter++;
          data = Buffer.from([
            counter >> 16,
            (counter >> 8) & 255,
            counter & 255,
          ]);
        }
        insert.run(z, x, 2 ** z - 1 - y, data);
      }
    }
  }
  db.exec("COMMIT");
  db.close();

  const fixture = new URL("fixture.pmtiles", OUT);
  execFileSync("pmtiles", ["convert", mbtiles, fixture.pathname], {
    stdio: "ignore",
  });

  const cases = [];
  for (const c of CASES) {
    const out = join(work, "out.pmtiles");
    execFileSync(
      "pmtiles",
      [
        "extract",
        fixture.pathname,
        out,
        `--bbox=${c.bbox.join(",")}`,
        `--maxzoom=${c.maxzoom}`,
        ...(c.minzoom != null ? [`--minzoom=${c.minzoom}`] : []),
      ],
      { stdio: "ignore" },
    );
    cases.push({
      ...c,
      expected: await dumpArchive(new Uint8Array(readFileSync(out))),
    });
  }
  const source = await dumpArchive(new Uint8Array(readFileSync(fixture)));
  writeFileSync(
    new URL("expected.json", OUT),
    JSON.stringify({ sourceHasLeaves: source.leafDirectories, cases }) + "\n",
  );
  // In the repo's format, so the commit hook takes the file as written.
  execFileSync(
    "npx",
    ["biome", "format", "--write", new URL("expected.json", OUT).pathname],
    { stdio: "ignore" },
  );
  console.log(
    `fixture: ${source.entries.length} entries, leaves: ${source.leafDirectories}`,
  );
  for (const c of cases)
    console.log(`${c.name}: ${c.expected.entries.length} entries`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

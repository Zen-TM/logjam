import { describe, it, expect } from "vitest";
import { PMTiles, TileType, type Source, type RangeResponse } from "pmtiles";
import {
  flatPng,
  lineVectorTile,
  singleTilePmtiles,
  tileAt,
  tileBounds,
} from "../../prisma/seedArchives";

// The seeded topo jobs serve these archives to Logjam Web's map. The reader
// below is the one the browser uses, so an archive it cannot read is one the
// map cannot draw.
//
// Mutations that turn this red: a wrong offset or length in the directory or
// header (the tile comes back short or not at all), a tile id computed for
// another tile, a PNG chunk with a bad CRC or length.

const bufferSource = (bytes: Buffer): Source => ({
  getKey: () => "seed",
  getBytes: async (offset: number, length: number): Promise<RangeResponse> => {
    const slice = bytes.subarray(offset, offset + length);
    return {
      data: slice.buffer.slice(
        slice.byteOffset,
        slice.byteOffset + slice.byteLength,
      ) as ArrayBuffer,
    };
  },
});

describe("seeded tile archives", () => {
  const { z, x, y } = tileAt(12, 150.3179, -33.6563);

  it("holds its one tile at the address it states", async () => {
    const png = flatPng(120);
    const archive = new PMTiles(
      bufferSource(singleTilePmtiles({ z, x, y, tile: png, type: "png" })),
    );
    const header = await archive.getHeader();
    expect(header.tileType).toBe(TileType.Png);
    expect([header.minZoom, header.maxZoom]).toEqual([z, z]);
    const got = await archive.getZxy(z, x, y);
    expect(Buffer.from(got!.data)).toEqual(png);
    expect(await archive.getZxy(z, x + 1, y)).toBeUndefined();
  });

  it("states the tile's own bounds", async () => {
    const archive = new PMTiles(
      bufferSource(
        singleTilePmtiles({
          z,
          x,
          y,
          tile: lineVectorTile("contours", [
            [0, 2048],
            [4096, 2048],
          ]),
          type: "mvt",
        }),
      ),
    );
    const header = await archive.getHeader();
    const [west, south, east, north] = tileBounds(z, x, y);
    expect(header.tileType).toBe(TileType.Mvt);
    expect(header.minLon).toBeCloseTo(west, 6);
    expect(header.minLat).toBeCloseTo(south, 6);
    expect(header.maxLon).toBeCloseTo(east, 6);
    expect(header.maxLat).toBeCloseTo(north, 6);
  });

  it("writes a PNG with the signature, a sized header and a closing chunk", () => {
    const png = flatPng(80);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(256);
    expect(png.readUInt32BE(20)).toBe(256);
    expect(png.subarray(-8, -4).toString("ascii")).toBe("IEND");
  });
});

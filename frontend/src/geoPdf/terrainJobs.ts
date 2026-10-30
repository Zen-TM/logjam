// The terrain pixel work of one strip, cut into bands of output rows so that
// several workers can each do one. A band is a pure function of its inputs: it
// paints the DEM rows it reads and resamples them onto its map rows with the
// same functions the whole strip would use, so the bands put side by side are
// the bytes of the strip done in one piece (terrainJobs.test.ts holds that).
import { TILE_SIZE, type SlopeBand } from "@logjam/shared";
import {
  decodeTerrarium,
  hillshadePixels,
  resampleGrid,
  resampleReach,
  slopePixels,
  type GridPlacement,
} from "./terrain";

export type TerrainBand = {
  kind: "hillshade" | "slope";
  /** The DEM block's values for rows `gridRow0`…, `width` across. */
  values: Float32Array;
  width: number;
  /** Row of the whole block that `values` starts at. */
  gridRow0: number;
  /** Row of the block's first tile row in the whole DEM grid, in pixels. */
  blockRow0: number;
  zoom: number;
  /** Tile row (of the DEM zoom) at the top of the block. */
  tileY: number;
  bands: readonly SlopeBand[];
  place: GridPlacement;
  smooth: boolean;
  outW: number;
  outY: number;
  outH: number;
};

/**
 * Which rows of a block (`blockRows` tall) the map rows `outY…outY+outH` read
 * after painting, and the margin the hillshade needs round them: `[from, to)`.
 */
export function bandRows(
  place: GridPlacement,
  blockRow0: number,
  blockRows: number,
  outY: number,
  outH: number,
): { from: number; to: number } {
  const first =
    Math.floor((outY + 0.5) / place.scaleY + place.offsetY - 0.5) - blockRow0;
  const last =
    Math.floor((outY + outH - 0.5) / place.scaleY + place.offsetY - 0.5) -
    blockRow0;
  // The resample reads a row and the one below it; the hillshade reads a row
  // beside each pixel it paints. `to` is exclusive.
  return {
    from: Math.max(0, first - 1),
    to: Math.min(blockRows, last + 3),
  };
}

let paintBuffer = new Uint8ClampedArray(0);

/** Paint and resample one band: RGBA for `outH` rows of `outW`. */
export function runTerrainBand(job: TerrainBand): Uint8ClampedArray {
  const rows = job.values.length / job.width;
  const grid = { values: job.values, width: job.width, height: rows };
  const srcRow0 = job.blockRow0 + job.gridRow0;
  // Only the pixels the resample reads are painted: the grid is whole tiles
  // across, wider than the map.
  const rect = resampleReach(
    job.width,
    rows,
    srcRow0,
    job.place,
    job.smooth,
    job.outW,
    job.outY,
    job.outH,
  );
  // The painted pixels are read once, by the resample below, so one buffer
  // serves every band this thread paints: a helper then leaves no band-sized
  // garbage behind it but the rows it was sent.
  const size = job.values.length * 4;
  if (paintBuffer.length < size) paintBuffer = new Uint8ClampedArray(size);
  const out = paintBuffer.subarray(0, size).fill(0);
  const pixels =
    job.kind === "hillshade"
      ? hillshadePixels(grid, job.zoom, job.tileY, out, job.gridRow0, rect)
      : slopePixels(grid, job.bands, out, rect);
  return resampleGrid(
    pixels,
    job.width,
    rows,
    srcRow0,
    job.place,
    job.smooth,
    job.outW,
    job.outY,
    job.outH,
  );
}

let tileCtx: OffscreenCanvasRenderingContext2D | null = null;

/** A terrarium PNG's values (heights or degrees), or null when it will not decode. */
export async function decodeTerrainTile(
  bytes: ArrayBuffer,
): Promise<Float32Array | null> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes]), {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    tileCtx ??= new OffscreenCanvas(TILE_SIZE, TILE_SIZE).getContext("2d", {
      willReadFrequently: true,
    })!;
    tileCtx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
    tileCtx.drawImage(bmp, 0, 0);
    bmp.close();
    const { data } = tileCtx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
    return decodeTerrarium(data, TILE_SIZE, TILE_SIZE).values;
  } catch {
    return null;
  }
}

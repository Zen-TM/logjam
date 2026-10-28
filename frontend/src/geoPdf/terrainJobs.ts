// The terrain pixel work of one strip, cut into bands of output rows so that
// several workers can each do one. A band is a pure function of its inputs: it
// paints the DEM rows it reads and resamples them onto its map rows with the
// same functions the whole strip would use, so the bands put side by side are
// the bytes of the strip done in one piece (terrainJobs.test.ts holds that).
import type { SlopeBand } from "@logjam/shared";
import {
  hillshadePixels,
  resampleGrid,
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

/** Paint and resample one band: RGBA for `outH` rows of `outW`. */
export function runTerrainBand(job: TerrainBand): Uint8ClampedArray {
  const rows = job.values.length / job.width;
  const grid = { values: job.values, width: job.width, height: rows };
  const pixels =
    job.kind === "hillshade"
      ? hillshadePixels(
          grid,
          job.zoom,
          job.tileY,
          new Uint8ClampedArray(job.values.length * 4),
          job.gridRow0,
        )
      : slopePixels(grid, job.bands);
  return resampleGrid(
    pixels,
    job.width,
    rows,
    job.blockRow0 + job.gridRow0,
    job.place,
    job.smooth,
    job.outW,
    job.outY,
    job.outH,
  );
}

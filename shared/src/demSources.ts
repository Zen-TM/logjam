// Which DEMs Logjam reads heights from, and which one answers for a position.
//
// One declaration and one sampler, so the API, Logjam GPS and Logjam Web
// cannot disagree about where a height came from. Each runtime supplies only
// its own tile I/O (a `DemTileReader`): the API fetches and decodes with
// `canvas`, Logjam GPS reads saved files and decodes with `fflate`.
// docs/decisions/0028-a-height-comes-from-the-finest-dem-source-that-has-it.md
//
// PRIVACY: positions here are precise wilderness coordinates and a tile index
// is a coarse location. Nothing in this file logs, and no reader may.

import {
  demSampleHeight,
  resolveDemSamples,
  type DemSampleAddress,
} from "./demTiles.js";
import type { SamplePosition } from "./elevation.js";

export type DemSource = {
  /** Recorded on a saved `dem-region` file and on every result read from it. */
  id: string;
  /**
   * The one zoom heights are read at. Tiles saved for offline use are fetched
   * at this zoom too, so a saved area can never hold a depth the sampler
   * cannot use.
   */
  sampleZoom: number;
  /**
   * [west, south, east, north] the source can answer in, or null for
   * worldwide. Inside it a missing tile or a no-data pixel still means "not
   * here", and the position falls through to the next source.
   */
  coverage: readonly [number, number, number, number] | null;
  /** XYZ template; `{y}` is the XYZ row, not the TMS row MBTiles stores. */
  urlTemplate: string;
  /** Required by the source's terms wherever a height from it is shown. */
  credit: string;
  /** The same credit for MapLibre, which renders HTML in `attribution`. */
  creditHtml: string;
};

/**
 * AWS Open Data terrain tiles: ~30 m SRTM over Australia. A z13 tile is
 * ~4.9 km across at this latitude, so its 256 px grid lands near 19 m/px: a
 * little finer than the data, and deeper zooms only interpolate.
 */
export const TERRARIUM = {
  id: "terrarium",
  sampleZoom: 13,
  coverage: null,
  urlTemplate:
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  credit: "Terrain data: Terrain Tiles (Mapzen / Tilezen), via AWS Open Data.",
  creditHtml:
    'Terrain data: <a href="https://registry.opendata.aws/terrain-tiles">Terrain Tiles</a> (Mapzen / Tilezen).',
} as const satisfies DemSource;

/** Every source, finest first. The order IS the precedence. */
export const DEM_SOURCES: readonly DemSource[] = [TERRARIUM];

/**
 * The tile URL for an address in a source, at the zoom it is read at.
 *
 * The y is the XYZ row, NOT the TMS row an MBTiles store flips to. Getting
 * that wrong does not error: it returns a valid tile for somewhere else, and
 * the caller shows a confident height from the wrong place.
 */
export function demTileUrl(
  source: DemSource,
  tileX: number,
  tileY: number,
): string {
  return source.urlTemplate
    .replace("{z}", String(source.sampleZoom))
    .replace("{x}", String(tileX))
    .replace("{y}", String(tileY));
}

/** The credit lines for the sources a result was read from. */
export function demCredits(
  sourceIds: readonly string[] = DEM_SOURCES.map((source) => source.id),
  sources: readonly DemSource[] = DEM_SOURCES,
): string[] {
  return sources
    .filter((source) => sourceIds.includes(source.id))
    .map((source) => source.credit);
}

export type DemTileAddress = { tileX: number; tileY: number };

/** The key a `DemTileReader` files a decoded tile under. */
export function demTileKey({ tileX, tileY }: DemTileAddress): string {
  return `${tileX}/${tileY}`;
}

/**
 * A runtime's tile I/O: the decoded tiles it has for `source`, at the source's
 * `sampleZoom`, keyed by `demTileKey`. A tile that does not exist is simply
 * absent; a failure the caller must not mistake for "no terrain" throws.
 */
export type DemTileReader = (
  source: DemSource,
  tiles: readonly DemTileAddress[],
) => Promise<ReadonlyMap<string, Float32Array>>;

export type DemSamples = {
  /** Metres at each position, as read. Null where no source has a height. */
  heights: (number | null)[];
  /** The source each height came from. */
  sourceIds: (string | null)[];
  /**
   * `heights` with the offset between two sources taken out at each seam, so
   * climb and descent are summed from this and never count the join. Equal to
   * `heights` when one source answered throughout.
   */
  levelled: (number | null)[];
};

function covers(source: DemSource, position: SamplePosition): boolean {
  if (!source.coverage) return true;
  const [west, south, east, north] = source.coverage;
  return (
    position.lon >= west &&
    position.lon <= east &&
    position.lat >= south &&
    position.lat <= north
  );
}

/**
 * Read the DEM at each position, in order.
 *
 * Every position gets the finest source that has a height there. Where two
 * consecutive known samples come from different sources (a seam), the step
 * between them is measured in ONE source: the finest that has a height at
 * both, found by walking the list from the coarser of the two. That is not
 * always the coarser one itself: two footprints that only touch share neither,
 * and the walk goes on to a source under both. If none has both, the step is
 * not counted. `demSources.test.ts` holds each case.
 */
export async function sampleDem(
  positions: readonly SamplePosition[],
  readTiles: DemTileReader,
  sources: readonly DemSource[] = DEM_SOURCES,
): Promise<DemSamples> {
  const heights: (number | null)[] = positions.map(() => null);
  const ranks: number[] = positions.map(() => -1);

  /** The heights `sources[rank]` has for these positions, by position index. */
  async function read(rank: number, indices: readonly number[]) {
    const source = sources[rank]!;
    const inside = indices.filter((i) => covers(source, positions[i]!));
    const found = new Map<number, number>();
    if (inside.length === 0) return found;
    const addresses = resolveDemSamples(
      inside.map((i) => positions[i]!),
      source.sampleZoom,
    );
    const wanted = new Map<string, DemSampleAddress>();
    for (const address of addresses) wanted.set(demTileKey(address), address);
    const tiles = await readTiles(source, [...wanted.values()]);
    inside.forEach((i, k) => {
      const address = addresses[k]!;
      const height = demSampleHeight(tiles.get(demTileKey(address)), address);
      if (height != null) found.set(i, height);
    });
    return found;
  }

  let open = positions.map((_, i) => i);
  for (let rank = 0; rank < sources.length && open.length > 0; rank++) {
    const found = await read(rank, open);
    for (const [i, height] of found) {
      heights[i] = height;
      ranks[i] = rank;
    }
    open = open.filter((i) => !found.has(i));
  }

  const levelled = heights.slice();
  let previous = -1;
  let offset = 0;
  for (let i = 0; i < heights.length; i++) {
    const height = heights[i];
    if (height == null) continue;
    if (previous >= 0 && ranks[i] !== ranks[previous]) {
      let step = 0;
      const coarser = Math.max(ranks[i]!, ranks[previous]!);
      for (let rank = coarser; rank < sources.length; rank++) {
        const both = await read(rank, [previous, i]);
        if (both.size === 2) {
          step = both.get(i)! - both.get(previous)!;
          break;
        }
      }
      offset = levelled[previous]! + step - height;
    }
    levelled[i] = height + offset;
    previous = i;
  }

  return {
    heights,
    sourceIds: ranks.map((rank) => sources[rank]?.id ?? null),
    levelled,
  };
}

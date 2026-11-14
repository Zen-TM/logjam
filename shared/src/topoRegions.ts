// What topo/ reads of `REGIONS`: topo/regions.json, written from the
// declaration by `scripts/topo-regions.mjs` (run `npm run topo-regions` here)
// so Python never parses TypeScript. The file holds only what a worker needs
// to find a region and name its archives: where it is, where its archives are
// and what they credit. Guard: `topoRegions.test.ts` ("is what the script
// writes").
import {
  REGIONS_WITH_SIMULATED,
  type Region,
  type RegionTerrain,
} from "./regions.js";
import { SIM_REGIONS } from "./simRegions.js";

type TopoArchive = {
  id: string;
  archivePath: string;
  minzoom?: number;
  maxzoom?: number;
  sampleZoom?: number;
  coverage: readonly [number, number, number, number];
  credit: string;
  creditHtml: string;
};

const NOTE =
  "Written from shared/src/regions.ts: change the declaration and rerun the script in shared/scripts, not this file.";

function archive(a: TopoArchive): TopoArchive {
  // Listed one by one, in this order: the file is a contract with topo/regions.py.
  const out: TopoArchive = {
    id: a.id,
    archivePath: a.archivePath,
    coverage: a.coverage,
    credit: a.credit,
    creditHtml: a.creditHtml,
  };
  if (a.minzoom !== undefined) out.minzoom = a.minzoom;
  if (a.maxzoom !== undefined) out.maxzoom = a.maxzoom;
  if (a.sampleZoom !== undefined) out.sampleZoom = a.sampleZoom;
  return out;
}

/**
 * The file's text: NSW, then the simulated regions marked `"sim": true`,
 * which topo/regions.py ignores unless the dev switch is on. It lists the
 * regions `REGIONS` holds with the switch on (topoRegions.test.ts, "lists the
 * regions the declaration holds with the simulated ones on").
 */
export function topoRegionsFile(): string {
  const entry = (region: Region) => ({
    id: region.id,
    name: region.name,
    ...(SIM_REGIONS.includes(region) ? { sim: true } : {}),
    borders: region.borders,
    terrain: Object.fromEntries(
      (Object.keys(region.terrain) as (keyof RegionTerrain)[]).flatMap(
        (key) => {
          const a = region.terrain[key];
          return a ? [[key, archive(a)]] : [];
        },
      ),
    ),
    placeSearch: region.placeSearch,
    gauges: region.gauges,
    grid: region.grid,
  });
  const regions = REGIONS_WITH_SIMULATED.map(entry);
  // A coordinate, and a list of numbers, stay on one line: a ring is long.
  const text = JSON.stringify({ note: NOTE, regions }, null, 1).replace(
    /\[[-\d.,\s]+\]/g,
    (list) => `[${list.slice(1, -1).trim().replace(/\s+/g, " ")}]`,
  );
  return `${text}\n`;
}

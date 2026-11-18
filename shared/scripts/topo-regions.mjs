// Writes ../topo/regions.json: the regions topo/ reads (src/topoRegions.ts).
// Run `npm run topo-regions` in shared/ after `npm run build`, whenever
// src/regions.ts or src/simRegions.ts changes. topoRegions.test.ts fails if
// the committed file drifts.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { topoRegionsFile } from "../dist/topoRegions.js";

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../topo/regions.json",
);
writeFileSync(out, topoRegionsFile());

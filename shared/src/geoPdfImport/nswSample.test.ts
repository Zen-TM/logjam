// Tier-3: real NSW Spatial Services topo GeoPDFs (CC-BY-4.0, not committed —
// tens of MB). Mirrors the repo's RUN_DB_IT env-gate pattern:
//
//   RUN_GEOPDF_SAMPLES=1 GEOPDF_SAMPLE_DIR=~/samples npm test
//
// Every *.pdf in the dir is parsed; sheets are expected to carry an ISO 32000
// /VP chain with a PROJCS (MGA) main viewport plus a small locator viewport.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { chooseMainViewport, parseGeoPdfGeoref } from "./parseGeoref";
import { buildGeoTransform } from "./transform";
import { buildTilePlan } from "./tilePlan";

const enabled = process.env.RUN_GEOPDF_SAMPLES === "1";
const sampleDir = process.env.GEOPDF_SAMPLE_DIR;

describe.runIf(enabled)("NSW Spatial Services sample sheets", () => {
  if (!enabled) return;
  if (!sampleDir) throw new Error("RUN_GEOPDF_SAMPLES=1 needs GEOPDF_SAMPLE_DIR");
  const samples = readdirSync(sampleDir).filter((f) => f.toLowerCase().endsWith(".pdf"));
  if (samples.length === 0) throw new Error(`no PDFs in ${sampleDir}`);

  for (const file of samples) {
    // Real sheets are tens of MB and plan hundreds of mesh tiles.
    it(`parses, transforms and plans ${file}`, { timeout: 60_000 }, async () => {
      const parsed = await parseGeoPdfGeoref(
        new Uint8Array(readFileSync(join(sampleDir, file))),
      );
      expect(parsed.pages.length).toBeGreaterThan(0);
      const page = parsed.pages[0];
      const main = page.viewports[chooseMainViewport(page)];

      // NSW sheets: projected main map, sane bounds inside NSW-ish extents.
      const transform = buildGeoTransform(main);
      const { north, south, east, west } = transform.wgs84Bounds;
      expect(north).toBeGreaterThan(south);
      expect(east).toBeGreaterThan(west);
      expect(south).toBeGreaterThan(-38);
      expect(north).toBeLessThan(-28);
      expect(west).toBeGreaterThan(140);
      expect(east).toBeLessThan(154);
      // Georef quality: a published sheet should fit far below the warn line.
      expect(transform.maxResidualFractionOfWidth).toBeLessThan(0.005);

      const clip =
        main.boundsPolygonPt ??
        [
          { x: main.bboxPt.x0, y: main.bboxPt.y0 },
          { x: main.bboxPt.x1, y: main.bboxPt.y0 },
          { x: main.bboxPt.x1, y: main.bboxPt.y1 },
          { x: main.bboxPt.x0, y: main.bboxPt.y1 },
        ];
      const plan = buildTilePlan(transform, clip);
      expect(plan.tiles.length).toBeGreaterThan(0);
      expect(plan.zMax).toBeGreaterThanOrEqual(10);
      expect(plan.zMax).toBeLessThanOrEqual(18);
    });
  }
});

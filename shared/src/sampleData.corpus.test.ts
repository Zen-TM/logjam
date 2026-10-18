// Golden tests on the large PUBLIC inputs that are not committed (an ELVIS
// LiDAR ZIP and DEM ZIP, an NSW topo GeoPDF sheet; CC BY 4.0, © State of NSW).
// `scripts/sample-data.sh` fetches them from the hash-pinned `sample-data-v1`
// release into SAMPLE_DATA_DIR; without that variable the real-file cases here
// are skipped, like nswSample.test.ts beside the parsers. To run them, from the
// repo root fetch the files (they land in the gitignored .cache/sample-data):
//
//   scripts/sample-data.sh elvis-katoomba-2506258-laz.zip \
//     elvis-katoomba-2506258-dem2m.zip nsw-topo-8929-4N-yerranderie.pdf
//
// then from shared/:
//
//   SAMPLE_DATA_DIR=../.cache/sample-data npx vitest run src/sampleData.corpus.test.ts
//
// Each golden (`__fixtures__/sample-data/*.golden`) is what the parser reports
// for that file, numbers rounded to 6 places. After an intended change, rerun
// with `-u` and read the diff. The ZIP-slip and empty-ZIP guards are in
// elvisZip.test.ts.
// Mutation that turns it red: changing DERIVATIVE_STEM_TOKENS (the ELVIS
// goldens change), or the control-point transform in buildGeoTransform (the
// sheet golden changes).
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  classifyElvisEntries,
  ElvisZipError,
  parseZipCentralDirectory,
} from "./elvisZip";
import {
  chooseMainViewport,
  parseGeoPdfGeoref,
} from "./geoPdfImport/parseGeoref";
import { buildTilePlan } from "./geoPdfImport/tilePlan";
import { buildGeoTransform } from "./geoPdfImport/transform";

const sampleDir = process.env.SAMPLE_DATA_DIR;
const golden = (name: string) =>
  join(__dirname, "__fixtures__", "sample-data", `${name}.golden`);

// Float noise below 1e-6 is platform arithmetic, not a change in the parser.
function render(value: unknown): string {
  return (
    JSON.stringify(
      value,
      (_key, v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v),
      2,
    ) + "\n"
  );
}

/** What the web client does: the last 64 KiB holds the central directory. */
function elvisReport(path: string): unknown {
  const bytes = new Uint8Array(readFileSync(path));
  const tail = bytes.subarray(Math.max(0, bytes.length - 65536));
  try {
    return classifyElvisEntries(parseZipCentralDirectory(tail, bytes.length));
  } catch (err) {
    if (err instanceof ElvisZipError)
      return { error: err.code, sentence: err.sentence };
    throw err;
  }
}

describe.runIf(sampleDir)("public sample inputs", () => {
  const file = (name: string) => join(sampleDir as string, name);

  for (const name of [
    "elvis-katoomba-2506258-laz.zip",
    "elvis-katoomba-2506258-dem2m.zip",
  ]) {
    it(`ELVIS checks report the golden for ${name}`, async () => {
      await expect(render(elvisReport(file(name)))).toMatchFileSnapshot(
        golden(name),
      );
    });
  }

  it("the NSW topo sheet parses, transforms and plans as the golden says", {
    timeout: 60_000,
  }, async () => {
    const path = file("nsw-topo-8929-4N-yerranderie.pdf");
    expect(statSync(path).size).toBeGreaterThan(1_000_000);
    const georef = await parseGeoPdfGeoref(new Uint8Array(readFileSync(path)));
    const page = georef.pages[0];
    const main = page.viewports[chooseMainViewport(page)];
    const transform = buildGeoTransform(main);
    const plan = buildTilePlan(
      transform,
      main.boundsPolygonPt ?? [
        { x: main.bboxPt.x0, y: main.bboxPt.y0 },
        { x: main.bboxPt.x1, y: main.bboxPt.y0 },
        { x: main.bboxPt.x1, y: main.bboxPt.y1 },
        { x: main.bboxPt.x0, y: main.bboxPt.y1 },
      ],
    );
    const tilesByZoom: Record<number, number> = {};
    for (const t of plan.tiles) tilesByZoom[t.z] = (tilesByZoom[t.z] ?? 0) + 1;
    await expect(
      render({
        georef,
        mainViewport: chooseMainViewport(page),
        transform: {
          kind: transform.kind,
          planeCrs: transform.planeCrs,
          planeIsWebMercator: transform.planeIsWebMercator,
          maxResidualFractionOfWidth: transform.maxResidualFractionOfWidth,
          wgs84Bounds: transform.wgs84Bounds,
        },
        plan: {
          zMin: plan.zMin,
          zMax: plan.zMax,
          tileSize: plan.tileSize,
          estimatedTotalTiles: plan.estimatedTotalTiles,
          tileCount: plan.tiles.length,
          tilesByZoom,
          firstTile: {
            z: plan.tiles[0].z,
            x: plan.tiles[0].x,
            y: plan.tiles[0].y,
          },
          lastTile: {
            z: plan.tiles[plan.tiles.length - 1].z,
            x: plan.tiles[plan.tiles.length - 1].x,
            y: plan.tiles[plan.tiles.length - 1].y,
          },
        },
      }),
    ).toMatchFileSnapshot(golden("nsw-topo-8929-4N-yerranderie.pdf"));
  });
});

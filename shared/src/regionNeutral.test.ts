// Nothing outside the region declaration names NSW's region, fire or coverage
// constants, so a second region cannot be silently answered with NSW's data.
// A file that still does is listed below. The test keeps the list exact: a
// file that names one without a line fails, and so does a line for a file that
// no longer does, so a new entry is an added line a reviewer sees. Each change
// that makes a file region-neutral deletes its line.
//
// Mutation that turns it red: add `NSW_REGION.view` to any new source file, or
// leave a file in the list after it stopped naming a constant.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repo = join(import.meta.dirname, "..", "..");
const PACKAGES = ["shared/src", "frontend/src", "mobile/src", "api/src"];
const NAMES = /\b(NSW_REGION|NSW_FIRE|NSW_COVERAGE)\b/;
const TEST_FILE = /\.test\.tsx?$|(^|\/)__(tests|fixtures|mocks)__\//;

// The declaration itself may name them.
const DECLARES = ["shared/src/regions.ts"];

const STILL_NAMING = [
  "api/src/routes/ropewiki.ts",
  "frontend/src/components/SignIn.tsx",
  "frontend/src/components/SignInTerrain.tsx",
  "frontend/src/geoPdf/bench.ts",
  "frontend/src/geoPdf/draw/land.ts",
  "frontend/src/geoPdf/plan.ts",
  "frontend/src/geoPdf/render.ts",
  "mobile/src/map/RegionDownloadScreen.tsx",
  "mobile/src/offline/regionDownloads.ts",
  "mobile/src/offline/regionTilePlanning.ts",
  "mobile/src/offline/regionUpdate.ts",
  "mobile/src/saved/SavedScreen.tsx",
  "shared/src/demSources.ts",
  "shared/src/geoPdfBaseLayers.ts",
  "shared/src/nswContours.ts",
  "shared/src/overlayLegends.ts",
  "shared/src/overlayZoom.ts",
  "shared/src/profileSeries.ts",
  "shared/src/terrain.ts",
];

function sources(dir: string): string[] {
  return readdirSync(join(repo, dir), { withFileTypes: true }).flatMap((e) => {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory())
      return e.name === "node_modules" || e.name === "dist"
        ? []
        : sources(path);
    return /\.tsx?$/.test(e.name) && !TEST_FILE.test(path) ? [path] : [];
  });
}

const scanned = PACKAGES.flatMap(sources);
const naming = scanned
  .filter((path) => NAMES.test(readFileSync(join(repo, path), "utf8")))
  .sort();

describe("files that name NSW's region constants", () => {
  // Mutation: scan one package fewer, or let the pattern stop matching. The
  // floor is on the files scanned, not the files naming a constant, which
  // falls as each change clears one.
  it("finds the declaration among the sources, so a scan that stops matching fails", () => {
    expect(naming).toEqual(expect.arrayContaining(DECLARES));
    expect(scanned.length).toBeGreaterThanOrEqual(1000);
  });

  // Mutation: a new file reads NSW_REGION.view.
  it("are the declaration and the files still on the list", () => {
    const unlisted = naming.filter(
      (path) => !DECLARES.includes(path) && !STILL_NAMING.includes(path),
    );
    expect(
      unlisted,
      "Read the region in view (regionInView, layerIn) instead of NSW's constants: docs/decisions/0049-what-a-map-offers-follows-the-ground-it-shows-and-an-accounts-chosen-regions-only-set-defaults.md",
    ).toEqual([]);
  });

  // Mutation: leave a file on the list after it stops naming a constant.
  it("leave the list only when they do", () => {
    const cleared = STILL_NAMING.filter((path) => !naming.includes(path));
    expect(cleared, "Delete these lines from STILL_NAMING").toEqual([]);
    expect(STILL_NAMING).toEqual([...STILL_NAMING].sort());
  });
});

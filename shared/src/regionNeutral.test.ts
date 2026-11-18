// Nothing outside the region declaration names a region: NSW's region, fire
// and coverage constants and the simulated regions are read only in
// `regions.ts` and `simRegions.ts`. A second region is then answered from the
// region in view, never from NSW's data by default, and a client cannot offer
// made-up regions in prod. Adding a region: docs/operations/adding-a-region.md.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repo = join(import.meta.dirname, "..", "..");
const PACKAGES = ["shared/src", "frontend/src", "mobile/src", "api/src"];
const TEST_FILE = /\.test\.tsx?$|(^|\/)__(tests|fixtures|mocks)__\//;

// The declaration itself, and the simulated regions it takes in.
const DECLARES = ["shared/src/regions.ts", "shared/src/simRegions.ts"];

const NSW_NAMES = /\b(NSW_REGION|NSW_FIRE|NSW_COVERAGE)\b/;
const SIM_NAMES = /\b(SIM_REGIONS|SIM_NZ|SIM_UTAH|SIM_WORLD)\b/;
// `SIM_REGIONS` is also the API's environment variable. Its spellings as one
// (`api/src/loadEnv.ts`, the key in `api/src/lib/env.ts`) do not read the
// declaration.
const SIM_ENV_VAR =
  /process\.env\.SIM_REGIONS|\bSIM_REGIONS=1|\bSIM_REGIONS: z\./g;

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
const naming = (names: RegExp, strip?: RegExp) =>
  scanned
    .filter((path) => {
      const text = readFileSync(join(repo, path), "utf8");
      return names.test(strip ? text.replace(strip, "") : text);
    })
    .sort();

describe("files that name a region", () => {
  // Mutation: scan one package fewer, or let either pattern stop matching. The
  // floor is on the files scanned and on both patterns finding the
  // declaration, so a scan that checks nothing fails.
  it("finds the declaration among the sources, so a scan that stops matching fails", () => {
    expect(naming(NSW_NAMES)).toContain("shared/src/regions.ts");
    expect(naming(SIM_NAMES)).toEqual(expect.arrayContaining(DECLARES));
    expect(scanned.length).toBeGreaterThanOrEqual(1000);
  });

  // Mutation: a new source file reads `NSW_REGION.view`.
  it("name NSW's region, fire and coverage constants nowhere but the declaration", () => {
    expect(
      naming(NSW_NAMES).filter((path) => !DECLARES.includes(path)),
      "Read the region in view (regionInView, layerIn) instead of NSW's constants, so a second region is answered from its own data. Adding a region: docs/operations/adding-a-region.md. Why: docs/decisions/0049-what-a-map-offers-follows-the-ground-it-shows-and-an-accounts-chosen-regions-only-set-defaults.md",
    ).toEqual([]);
  });

  // Mutation: a client or the API imports `SIM_NZ` (or `SIM_REGIONS`,
  // `SIM_UTAH`, `SIM_WORLD`). The shared index exports all four, so the import
  // compiles, and the client would offer made-up regions in prod.
  it("name the simulated regions nowhere but the declaration", () => {
    expect(
      naming(SIM_NAMES, SIM_ENV_VAR).filter((path) => !DECLARES.includes(path)),
      "Only `REGIONS` and `WORLD` (regions.ts) take in the simulated regions, and only where the dev switch is on; a client that reads one offers made-up regions in prod. Use `REGIONS`. Adding a region: docs/operations/adding-a-region.md. Why: docs/decisions/0049-what-a-map-offers-follows-the-ground-it-shows-and-an-accounts-chosen-regions-only-set-defaults.md",
    ).toEqual([]);
  });
});

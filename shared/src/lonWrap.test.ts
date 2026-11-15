import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A longitude is wrapped into [-180, 180) by `wrapLon` in `placeGeo.ts` and
// nowhere else: a second copy of the arithmetic is one that a fix to the first
// (the exactness of an in-range longitude, the half-open end) does not reach.
// This scans source for the idiom, `(lon + 180) % 360`.
//
// Mutation that turns it red: write `((((lon + 180) % 360) + 360) % 360) - 180`
// back in `grids.ts` or `geoPdfImport/crs.ts`.

const SCANNED = ["shared/src", "frontend/src", "mobile/src", "api/src"];
const WRAP_IDIOM = /\+\s*180\)\s*%\s*360/;
const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

function sourceFiles(dir: string): string[] {
  return (readdirSync(join(REPO, dir), { recursive: true }) as string[])
    .filter(
      (file) =>
        /\.tsx?$/.test(file) &&
        !/\.test\.tsx?$/.test(file) &&
        !/(^|[\\/])(__fixtures__|__tests__|node_modules|dist)[\\/]/.test(file),
    )
    .map((file) => `${dir}/${file}`);
}

describe("the longitude wrap", () => {
  it("is written once, in `wrapLon`", () => {
    const files = SCANNED.flatMap(sourceFiles);
    const text = (file: string) => readFileSync(join(REPO, file), "utf8");
    // Floors: a scan over nothing finds no second copy, and the wrap is in use.
    expect(files.length).toBeGreaterThan(500);
    expect(
      files.filter((file) => /\bwrapLon\(/.test(text(file))).length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      files.filter((file) => WRAP_IDIOM.test(text(file))),
      "Wrap a longitude with `wrapLon` from shared/src/placeGeo.ts, not with a second copy of its arithmetic",
    ).toEqual([]);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A longitude is wrapped into [-180, 180) by `wrapLon` in `placeGeo.ts` and
// nowhere else: a second copy of the arithmetic is one that a fix to the first
// (the exactness of an in-range longitude, the half-open end) does not reach.
// This scans source for two spellings of the wrap:
//   - the modulo form, `(lon + 180) % 360`, which holds the common
//     `((((lon + 180) % 360) + 360) % 360) - 180` too;
//   - the floor form, `Math.floor((x + 180) / 360)`, a `/ 360)` not followed by
//     `*`: the tile maths divides `(lon + 180) / 360` and multiplies it by the
//     tile count, which is not a wrap and stays.
// It does not hold the form `((d % 360) + 540) % 360 - 180`: `heading.ts` writes
// it for a compass heading, which is an angle and not a longitude, and a scan
// cannot tell the two apart. There is no allow-list, so a wrap spelled any
// other way is for review.
//
// Mutation that turns it red: write `((((lon + 180) % 360) + 360) % 360) - 180`
// back in `grids.ts` or `geoPdfImport/crs.ts`, or `360 * Math.floor((c + 180)
// / 360)` in `regions.ts`.

const SCANNED = ["shared/src", "frontend/src", "mobile/src", "api/src"];
const SPELLINGS: Record<string, RegExp> = {
  modulo: /\+\s*180\)\s*%\s*360/,
  floor: /\+\s*180\)\s*\/\s*360\)(?!\s*\*)/,
};
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
  // Mutation: loosen the `floor` pattern to drop its `(?!\s*\*)`, and the tile
  // maths in `snapTiles.ts` reads as a wrap.
  it("is written once, in `wrapLon`", () => {
    const files = SCANNED.flatMap(sourceFiles);
    const text = (file: string) => readFileSync(join(REPO, file), "utf8");
    // Floors: a scan over nothing finds no second copy, and the wrap is in use.
    expect(files.length).toBeGreaterThan(500);
    expect(
      files.filter((file) => /\bwrapLon\(/.test(text(file))).length,
    ).toBeGreaterThanOrEqual(4);
    // The tile maths is in the scan and is not taken for a wrap.
    expect(text("shared/src/snapTiles.ts")).toMatch(/\+\s*180\)\s*\/\s*360\)/);
    for (const [spelling, pattern] of Object.entries(SPELLINGS))
      expect(
        files.filter((file) => pattern.test(text(file))),
        `Wrap a longitude with \`wrapLon\` from shared/src/placeGeo.ts, not with a second copy of its arithmetic (${spelling} form)`,
      ).toEqual([]);
  });

  // Mutation: replace `modulo` with `/\+\s*181\)\s*%\s*360/` (or `floor` with
  // one that never matches), and the spelling it names is no longer found.
  it("finds each spelling it holds", () => {
    expect("((((lon + 180) % 360) + 360) % 360) - 180").toMatch(
      SPELLINGS.modulo!,
    );
    expect("360 * Math.floor(((west + east) / 2 + 180) / 360);").toMatch(
      SPELLINGS.floor!,
    );
    expect("Math.floor(((lon + 180) / 360) * 2 ** zoom)").not.toMatch(
      SPELLINGS.floor!,
    );
  });
});

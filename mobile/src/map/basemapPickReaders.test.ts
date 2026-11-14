import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The stored basemap pick is kept whatever ground the map is over, so a pick
// that is not offered where the map is must not be drawn as it is. A file that
// reads `readBasemapPreference()` also passes the pick through
// `effectiveBasemap`, or defers to the screen that does; `readEffectiveBasemap`
// is the reader that does both and needs no line here.
const SRC = join(import.meta.dirname, "..");
const DEFERS_TO: Record<string, string> = {
  "map/pickPointStart.ts": "map/PickPointScreen.tsx",
};

function sources(dir: string): string[] {
  return readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((e) => {
    const path = `${dir}/${e.name}`.replace(/^\.\//, "");
    if (e.isDirectory()) return sources(path);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
      ? [path]
      : [];
  });
}
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

const readers = sources(".").filter(
  (path) =>
    path !== "map/basemapPreference.ts" &&
    /\breadBasemapPreference\b/.test(read(path)),
);

describe("the readers of the stored basemap pick", () => {
  // Mutation: change a reader's file to read the pick and never call
  // `effectiveBasemap`, or point DEFERS_TO at a screen that does not.
  it("pass it through effectiveBasemap before drawing it", () => {
    expect(readers.length).toBeGreaterThanOrEqual(2);
    for (const path of readers) {
      const applies = /\beffectiveBasemap\(/.test(read(path));
      const deferred = DEFERS_TO[path];
      expect(
        applies || (deferred && /\beffectiveBasemap\(/.test(read(deferred))),
        `${path} reads readBasemapPreference() without effectiveBasemap(pick, view): use readEffectiveBasemap(view)`,
      ).toBeTruthy();
    }
  });

  it("lists a deferral only for a file that reads the pick", () => {
    for (const path of Object.keys(DEFERS_TO))
      expect(readers, `DEFERS_TO names ${path}`).toContain(path);
  });
});

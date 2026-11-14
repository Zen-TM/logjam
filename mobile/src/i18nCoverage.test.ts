import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { ceilingFailures, I18N_ADR, scanSources } from "@logjam/shared";

// User-facing text goes through `t`, `plural`, `rich` or `say`
// (docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md).
// Text written the old way is counted per directory and may only fall: new
// copy in Logjam GPS goes through the catalogue, and a directory that moves its
// text lowers its number in the same change. The scanner is `i18nSource.ts` in
// @logjam/shared; what it must and must not flag is held in its own test.

const SRC = dirname(fileURLToPath(import.meta.url));
// The root component holds user copy too ("Update required"); it is counted with `.`.
const APP = join(SRC, "..", "App.tsx");

/** Bare literals a user may read, per directory under src. Lower an entry when its text moves; never raise one. */
const CEILINGS: Record<string, number> = {
  ".": 21,
  api: 2,
  auth: 20,
  customFields: 31,
  gauges: 1,
  geopdf: 28,
  imports: 19,
  logs: 40,
  map: 167,
  media: 45,
  notifications: 4,
  offline: 85,
  places: 88,
  plans: 16,
  routes: 23,
  saved: 172,
  screens: 331,
  "screens/settings": 104,
  sharing: 71,
  sync: 13,
  tracks: 56,
  ui: 49,
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return /^__(?:tests|fixtures)__$/.test(entry.name) ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|d)\./.test(entry.name)
      ? [path]
      : [];
  });
}

// Parsing every source file takes seconds under load, so it runs once, in a
// beforeAll with a long timeout, as `copyRules.test.ts` does.
let scan: ReturnType<typeof scanSources>;
let fileCount = 0;
beforeAll(() => {
  const files = [...sources(SRC), APP].map((path) => ({
    path: path === APP ? "App.tsx" : relative(SRC, path),
    source: readFileSync(path, "utf8"),
  }));
  fileCount = files.length;
  scan = scanSources(ts, "mobile", files);
}, 30_000);

describe("Logjam GPS i18n coverage", () => {
  // Mutation: change `sources`'s extension test to `/\.tsxx?$/`, so it finds no file.
  it("reads the source at all — a silent zero would pass forever", () => {
    expect(fileCount).toBeGreaterThan(300);
    // Nothing in Logjam GPS is written through the catalogue yet, so the
    // floor on what the scan reads is its bare literals.
    expect(scan.bare.length).toBeGreaterThan(1000);
  });

  // Mutation: add ``export const zz = t` leading`;`` to any source file.
  it("holds every message to the hygiene rules", () => {
    expect(
      scan.messages
        .filter((message) => message.problems.length)
        .map(
          ({ file, line, key, problems }) =>
            `${file}:${line} "${key}": ${problems.join("; ")} (${I18N_ADR})`,
        ),
    ).toEqual([]);
  });

  // Mutation: drop `APP` from the list in `beforeAll`, or add
  // `export const zz = "Open the file";` to any source file, or
  // raise or lower a ceiling, or move a directory's text into `t` without lowering it.
  it("writes no new text outside the catalogue, and every ceiling is the count", () => {
    expect(ceilingFailures(scan.counts, CEILINGS, scan.bare)).toEqual([]);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { ceilingFailures, I18N_ADR, scanSources } from "@logjam/shared";

// User-facing text goes through `t`, `plural`, `rich` or `say`
// (docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md).
// Text written the old way is counted per directory and may only fall: new
// copy in the API goes through the catalogue, and a directory that moves its
// text lowers its number in the same change. The scanner is `i18nSource.ts` in
// @logjam/shared; what it must and must not flag is held in its own test.
//
// Mutation that turns it red: add `const x = "Open the file";` to any file in
// api/src, or move the text of a directory into `t` without lowering its ceiling.

const SRC = dirname(fileURLToPath(import.meta.url));

/** Bare literals a user may read, per directory under src. Lower an entry when its text moves; never raise one. */
const CEILINGS: Record<string, number> = {
  lib: 11,
  middleware: 4,
  routes: 11,
  scripts: 3,
  services: 27,
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
  const files = sources(SRC).map((path) => ({
    path: relative(SRC, path),
    source: readFileSync(path, "utf8"),
  }));
  fileCount = files.length;
  scan = scanSources(ts, "api", files);
}, 30_000);

describe("the API i18n coverage", () => {
  it("reads the source at all — a silent zero would pass forever", () => {
    expect(fileCount).toBeGreaterThan(80);
    // About 247 `say` messages today; the floor sits well under, so a few can
    // go but a directory the scan stops reaching cannot.
    expect(scan.messages.length).toBeGreaterThan(200);
  });

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

  it("writes no new text outside the catalogue, and every ceiling is the count", () => {
    expect(ceilingFailures(scan.counts, CEILINGS)).toEqual([]);
  });
});

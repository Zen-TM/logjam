import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import {
  bareCopyFailures,
  I18N_ADR,
  ratchetReads,
  scanSources,
} from "@logjam/shared";

// User-facing text goes through `t`, `plural`, `rich` or `say`
// (docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md).
// Any other text in Logjam GPS is a failure here. The scanner is `i18nSource.ts` in
// @logjam/shared; what it must and must not flag is held in its own test.

const SRC = dirname(fileURLToPath(import.meta.url));
// The root component holds user copy too ("Update required"), so it is read with `src`.
const APP = join(SRC, "..", "App.tsx");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return ratchetReads(entry.name, true) ? sources(path) : [];
    return ratchetReads(entry.name, false) ? [path] : [];
  });
}

// Parsing every source file takes seconds under load, so it runs once, in a
// beforeAll with a long timeout, as `copyRules.test.ts` does.
let scan: ReturnType<typeof scanSources>;
let fileCount = 0;
let scanned: string[] = [];
beforeAll(() => {
  const files = [...sources(SRC), APP].map((path) => ({
    path: path === APP ? "App.tsx" : relative(SRC, path),
    source: readFileSync(path, "utf8"),
  }));
  fileCount = files.length;
  scanned = files.map((file) => file.path);
  scan = scanSources(ts, "mobile", files);
}, 30_000);

describe("Logjam GPS i18n coverage", () => {
  // Mutation: change `sources`'s extension test to `/\.tsxx?$/`, so it finds no file.
  it("reads the source at all — a silent zero would pass forever", () => {
    expect(fileCount).toBeGreaterThan(300);
    // Mutation: drop `APP` from the list in `beforeAll`.
    expect(scanned).toContain("App.tsx");
    // The floor is on the total found: bare literals fall as text moves into
    // messages, so their sum stays put while the scan keeps working.
    expect(scan.bare.length + scan.messages.length).toBeGreaterThan(1000);
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

  // Mutation: add `import { t as tr } from "@logjam/shared";` to any source file.
  it("imports the message functions by their own names", () => {
    expect(
      scan.imports.map(
        ({ file, line, problem }) => `${file}:${line} ${problem} (${I18N_ADR})`,
      ),
    ).toEqual([]);
  });

  // Mutation: add `<Text>Save the place</Text>` to any screen, or
  // `export const zz = "Open the file";` to any source file.
  it("writes no text outside the catalogue", () => {
    expect(bareCopyFailures(scan.bare)).toEqual([]);
  });
});

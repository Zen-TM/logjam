import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { enUS } from "./i18nCatalogues/en-US.js";
import {
  bareCopyIn,
  ceilingFailures,
  EXEMPT_FILES,
  I18N_ADR,
  messagesIn,
  missingEntries,
  orphanKeys,
  ratchetReads,
  scanSources,
} from "./i18nSource.js";

// User-facing text goes through `t`, `plural`, `rich` or `say`
// (docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md).
// Text written the old way is counted per directory and may only fall: new
// copy in @logjam/shared goes through the catalogue, and a directory that moves its
// text lowers its number in the same change. The scanner is `i18nSource.ts` in
// @logjam/shared; what it must and must not flag is held in its own test.

const SRC = dirname(fileURLToPath(import.meta.url));

/** Bare literals a user may read, per directory under src. Lower an entry when its text moves; never raise one. */
const CEILINGS: Record<string, number> = {
  ".": 650,
  contracts: 987,
  geoPdfImport: 1,
};

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
beforeAll(() => {
  const files = sources(SRC).map((path) => ({
    path: relative(SRC, path),
    source: readFileSync(path, "utf8"),
  }));
  fileCount = files.length;
  scan = scanSources(ts, "shared", files);
}, 30_000);

describe("@logjam/shared i18n coverage", () => {
  // Mutation: change `sources`'s extension test to `/\.tsxx?$/`, so it finds no file.
  it("reads the source at all — a silent zero would pass forever", () => {
    expect(fileCount).toBeGreaterThan(130);
    // About 46 messages today, all `say`.
    expect(scan.messages.length).toBeGreaterThan(40);
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

  // Mutation: add `export const zz = "Open the file";` to any source file, or
  // raise or lower a ceiling, or move a directory's text into `t` without lowering it.
  it("writes no new text outside the catalogue, and every ceiling is the count", () => {
    expect(ceilingFailures(scan.counts, CEILINGS, scan.bare)).toEqual([]);
  });
});

// Spellings the Australian source writes and US English does not: a message
// holding one has an entry in `i18nCatalogues/en-US.ts`. The list is empty
// because no entry is wanted yet; a word added to it needs an entry for every
// message that holds it.
const AUSTRALIAN_WORDS: readonly string[] = [];

describe("the en-US catalogue", () => {
  const REPO = join(SRC, "../..");
  // Every message in the four packages (about 200 distinct today): the catalogue is shared, so a key
  // belongs to a message in any of them.
  const keys = new Set<string>();
  beforeAll(() => {
    for (const pkg of ["shared", "frontend", "mobile", "api"]) {
      const root = join(REPO, pkg, "src");
      // Logjam GPS's root component sits beside its `src`.
      const extra = pkg === "mobile" ? [join(REPO, "mobile", "App.tsx")] : [];
      for (const path of [...sources(root), ...extra])
        for (const message of messagesIn(ts, path, readFileSync(path, "utf8")))
          keys.add(message.key);
    }
  }, 30_000);

  // Mutation: drop "api" from the package list in `beforeAll`.
  it("reads the messages of every package — a silent zero would pass forever", () => {
    expect(keys.size).toBeGreaterThan(150);
  });

  // Mutation: add `"Abseil down {0}": "Rappel down {0}"` to `enUS`, or reword
  // a message that has an entry without moving the entry.
  it("has no entry whose message is gone", () => {
    expect(
      orphanKeys(enUS, keys).map(
        (key) =>
          `"${key}" matches no message in source. A reworded message leaves its entry behind: move or delete it (${I18N_ADR}).`,
      ),
    ).toEqual([]);
  });

  // Mutation: put a word in `AUSTRALIAN_WORDS` that a message in source holds,
  // such as "cancell" (say`You cancelled this.` in api/src/routes/topoJobs.ts),
  // without an entry for that message.
  it("has an entry for every message that holds an Australian spelling", () => {
    expect(missingEntries(enUS, keys, AUSTRALIAN_WORDS)).toEqual([]);
  });
});

describe("the files the scan leaves out", () => {
  // Mutation: rename `ozUltimate.ts`, or reword every string in `kit.ts` so
  // the scan finds none there.
  it("each still exists and still has something to leave out", () => {
    const stale = Object.keys(EXEMPT_FILES).filter((path) => {
      try {
        const file = join(SRC, "../..", path);
        return bareCopyIn(ts, file, readFileSync(file, "utf8")).length === 0;
      } catch {
        return true;
      }
    });
    expect(
      stale.map(
        (path) =>
          `${path} is in EXEMPT_FILES (i18nSource.ts) but is gone or has no text left to leave out: update the entry, or delete it (${I18N_ADR}).`,
      ),
    ).toEqual([]);
  });
});

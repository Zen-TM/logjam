#!/usr/bin/env node
// Checks that a change moved text into the catalogue without changing its
// words: per changed tracked source file, the text pieces it spells
// (shared/src/i18nCodemod.ts, `textPieces`) before and after, with every piece
// added or removed printed. A piece reworded is one of each. It compares the
// pieces with their counts; not their order, nor the expressions between them,
// so swapped or dropped holes, or two sentences exchanged in one file, pass:
// read the hand edits. Exits 1 when any piece differs.
//
// Usage (build shared first: `make shared`):
//   node scripts/i18n-identity-check.mjs <base-ref>
//
// It compares the working tree with the merge base of <base-ref> and HEAD, so it
// reads uncommitted edits to tracked files and a branch alike, and a base that
// has moved on does not count as a change. A renamed file is read at its old
// path; a file added since (git knows it) is all additions. An untracked file is
// not listed: `git add` it first.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "shared/dist");
const base = process.argv[2];
if (!base || process.argv.length > 3) {
  console.error(
    "usage: i18n-identity-check.mjs <base-ref>  (tracked files; `git add` a new one first)\n" +
      "compares text pieces with their counts, not their order nor the expressions between them",
  );
  process.exit(2);
}
if (!existsSync(join(dist, "i18nCodemod.js"))) {
  console.error("shared/dist has no i18nCodemod.js: run `make shared` first.");
  process.exit(2);
}
const ts = createRequire(join(root, "shared/package.json"))("typescript");
const { textPieces, pieceChanges, changedFiles } = await import(`${dist}/i18nCodemod.js`);

const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });

const mergeBase = git("merge-base", base, "HEAD").trim();
const changed = changedFiles(
  git("diff", "--name-status", "-M", mergeBase, "--"),
);

let files = 0;
let differing = 0;
for (const { path, from } of changed) {
  const file = join(root, path);
  if (!existsSync(file)) continue;
  let before = "";
  try {
    before = execFileSync("git", ["show", `${mergeBase}:${from}`], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1 << 28,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // Added since the base: every piece is new.
  }
  files++;
  const { removed, added } = pieceChanges(
    textPieces(ts, path, before),
    textPieces(ts, path, readFileSync(file, "utf8")),
  );
  if (!removed.length && !added.length) continue;
  differing++;
  console.log(path);
  for (const piece of removed) console.log(`  - ${JSON.stringify(piece)}`);
  for (const piece of added) console.log(`  + ${JSON.stringify(piece)}`);
}
console.log(
  differing
    ? `${differing} of ${files} changed files differ in their text.`
    : `${files} changed files: the same text pieces as at the merge base.`,
);
process.exit(differing ? 1 : 0);

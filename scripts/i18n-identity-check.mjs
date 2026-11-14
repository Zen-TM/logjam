#!/usr/bin/env node
// Checks that a change moved text into the catalogue without changing it: per
// changed source file, the text pieces it spells (shared/src/i18nCodemod.ts,
// `textPieces`) before and after, with every piece added or removed printed.
// A piece reworded is one of each. Exits 1 when any differ, so a clean run is
// what `make format` and the type-check can then be trusted on.
//
// Usage (build shared first: `make shared`):
//   node scripts/i18n-identity-check.mjs <base-ref>
//
// It compares the working tree with <base-ref>, so it reads uncommitted work and
// a branch alike. A file added since <base-ref> is all additions.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "shared/dist");
const base = process.argv[2];
if (!base || process.argv.length > 3) {
  console.error("usage: i18n-identity-check.mjs <base-ref>");
  process.exit(2);
}
if (!existsSync(join(dist, "i18nCodemod.js"))) {
  console.error("shared/dist has no i18nCodemod.js: run `make shared` first.");
  process.exit(2);
}
const ts = createRequire(join(root, "shared/package.json"))("typescript");
const { textPieces, pieceChanges } = await import(`${dist}/i18nCodemod.js`);

const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });

const changed = git("diff", "--name-only", "--diff-filter=AMR", base, "--")
  .split("\n")
  .filter((path) => /\.tsx?$/.test(path) && !/\.d\.ts$/.test(path));

let files = 0;
let differing = 0;
for (const path of changed) {
  const file = join(root, path);
  if (!existsSync(file)) continue;
  let before = "";
  try {
    before = git("show", `${base}:${path}`);
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
    : `${files} changed files: the text is as it was.`,
);
process.exit(differing ? 1 : 0);

#!/usr/bin/env node
// Moves bare copy into the catalogue: rewrites the text `bareCopyIn`
// (shared/src/i18nSource.ts) counts into `t` messages, and lists what it leaves
// for a person, with why. What it rewrites and skips is held by
// shared/src/i18nCodemod.test.ts; the reasoning is docs/decisions/0050-*.md.
//
// Usage (build shared first: `make shared`):
//   node scripts/i18n-extract.mjs <file-or-directory>...   # rewrite in place
//   node scripts/i18n-extract.mjs --dry-run <path>...      # list only
//   node scripts/i18n-extract.mjs --words <path>...        # also one-word labels
//
// `--words` converts a capitalised single word in any position the scanner
// treats as text ("Friends", "Delete"), which the ratchet does not count: such a
// word is as often an id as a label, so read the diff. Then run `make format`
// and `node scripts/i18n-identity-check.mjs origin/main`.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "shared/dist");
if (!existsSync(join(dist, "i18nCodemod.js"))) {
  console.error("shared/dist has no i18nCodemod.js: run `make shared` first.");
  process.exit(2);
}
const ts = createRequire(join(root, "shared/package.json"))("typescript");
const { extractMessages, importFor } = await import(`${dist}/i18nCodemod.js`);
const { EXEMPT_FILES, ratchetReads } = await import(`${dist}/i18nSource.js`);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const paths = args.filter((arg) => !arg.startsWith("--"));
if (!paths.length || args.some((a) => a.startsWith("--") && !["--words", "--dry-run"].includes(a))) {
  console.error("usage: i18n-extract.mjs [--words] [--dry-run] <file-or-directory>...");
  process.exit(2);
}

/** Source files under `path`: what the ratchet reads (`ratchetReads`), less the catalogue's own folder and the installed or built copies, which the ratchet is never pointed at. A file named outright is taken as it is. */
function sources(path) {
  if (!readdirSafe(path)) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory())
      return ratchetReads(entry.name, true) &&
        !/^(?:i18nCatalogues|node_modules|dist)$/.test(entry.name)
        ? sources(child)
        : [];
    return ratchetReads(entry.name, false) ? [child] : [];
  });
}
function readdirSafe(path) {
  try {
    return readdirSync(path);
  } catch {
    return undefined;
  }
}

let messages = 0;
let skippedTotal = 0;
for (const file of paths.flatMap((p) => sources(resolve(p)))) {
  const repoPath = relative(root, file).split("\\").join("/");
  if (repoPath in EXEMPT_FILES) {
    console.log(`${repoPath}: exempt (${EXEMPT_FILES[repoPath]})`);
    continue;
  }
  const source = readFileSync(file, "utf8");
  const result = extractMessages(ts, file, source, {
    words: flag("--words"),
    importFrom: importFor(repoPath),
  });
  for (const skip of result.skipped)
    console.log(`${repoPath}:${skip.line}  left: ${skip.reason}\n    ${JSON.stringify(skip.text)}`);
  if (result.converted) {
    console.log(`${repoPath}: ${result.converted} message${result.converted === 1 ? "" : "s"}`);
    if (!flag("--dry-run")) writeFileSync(file, result.source);
  }
  messages += result.converted;
  skippedTotal += result.skipped.length;
}
console.log(
  `${flag("--dry-run") ? "would write" : "wrote"} ${messages} messages; left ${skippedTotal} for a person.`,
);

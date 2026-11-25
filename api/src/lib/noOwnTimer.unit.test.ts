import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

// Guard for api/AGENTS.md: a background sweep never gets its own timer, or two
// API processes would each run it. A recurring job is a `setInterval`, or a
// `setTimeout` that re-arms itself, so both names are held to the files below,
// each with the reason it may use one. Any mention of the name counts, so an
// alias (`const every = setInterval`) or `globalThis.setInterval` is seen too.
//
// Mutation that turns it red: a setInterval or setTimeout (or an alias of
// either) in a file not listed, or removing the reaper's setInterval.
const SRC = join(__dirname, "..");

const TIMERS: Record<string, Record<string, string>> = {
  setInterval: {
    [join("lib", "topoJobReaper.ts")]:
      "the sweep tick itself; it runs only in the process holding the lock",
    [join("lib", "shutdown.ts")]:
      "closes this process's own idle connections while it stops, which every process must do for itself",
  },
  setTimeout: {
    [join("index.ts")]: "the /ready database ping's deadline, one-shot",
    [join("lib", "shutdown.ts")]: "the forced-exit deadline, one-shot",
    [join("lib", "topoJobReaper.ts")]: "the first tick's delay, one-shot",
    [join("services", "placeRegistry.ts")]:
      "refreshes this process's own in-memory place index (no database write), so every process must run it",
  },
};

function* sources(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__") yield* sources(p);
    } else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) yield p;
  }
}

const files = [...sources(SRC)];
const used: Record<string, Set<string>> = {
  setInterval: new Set(),
  setTimeout: new Set(),
};
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!/setInterval|setTimeout/.test(text)) continue;
  const rel = file.slice(SRC.length + 1);
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && Object.hasOwn(used, node.text))
      used[node.text].add(rel);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
}

it("scans the source tree at all — an empty scan would pass forever", () => {
  expect(files.length).toBeGreaterThan(100);
  expect([...used.setInterval]).toContain(join("lib", "topoJobReaper.ts"));
});

it.each(Object.keys(TIMERS))("uses %s only where it is declared", (name) => {
  const offenders = [...used[name]].filter((f) => !(f in TIMERS[name]));
  expect(
    offenders,
    `a background sweep runs inside startTopoJobReaper's tick (lib/topoJobReaper.ts), ` +
      `never on its own timer. A file that really needs ${name} goes in TIMERS with its reason`,
  ).toEqual([]);
  const stale = Object.keys(TIMERS[name]).filter((f) => !used[name].has(f));
  expect(stale, `no longer uses ${name}: remove it from TIMERS`).toEqual([]);
});

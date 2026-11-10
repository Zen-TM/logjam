import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// Guard for api/AGENTS.md: a background sweep never gets its own timer, or two
// API processes would each run it. Mutation that turns it red: a setInterval
// added to a new file under lib/. (setTimeout is not checked: the ones in
// services/placeRegistry.ts and index.ts are one-shot.)
const ALLOWED = join("lib", "topoJobReaper.ts");
const SRC = join(__dirname, "..");

function* sources(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) yield p;
  }
}

it("has no setInterval outside the sweep reaper's tick", () => {
  const offenders = [...sources(SRC)]
    .filter((p) => readFileSync(p, "utf8").includes("setInterval("))
    .map((p) => p.slice(SRC.length + 1))
    .filter((p) => p !== ALLOWED);
  expect(offenders).toEqual([]);
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Two lists that must agree (root CLAUDE.md): the models the dev seed WRITES,
// and the `deleteMany()` calls at the top of main() that clear the DB before it
// writes them. A model that joins the first list and not the second survives a
// reseed, so dev accumulates rows nobody put there — and because most seeded
// tables happen to cascade from `user.deleteMany()`, the omission is invisible
// until someone adds a table with no user FK.
//
// The seed had no waypoints or routes at all until they were added for the
// Saved share marks; the wipe list did not name them either, so this test is
// what makes the next addition impossible to half-do.

const SEED = readFileSync(join(__dirname, "../../prisma/seed.ts"), "utf8");

/** Models the seed writes: `prisma.<model>.create` / `.createMany` / `.upsert`. */
function writtenModels(): Set<string> {
  return new Set(
    [...SEED.matchAll(/\bprisma\.([a-zA-Z]+)\.(?:create|createMany|upsert)\b/g)].map(
      (match) => match[1],
    ),
  );
}

/** Models the wipe clears: `prisma.<model>.deleteMany()`. */
function wipedModels(): Set<string> {
  return new Set(
    [...SEED.matchAll(/\bprisma\.([a-zA-Z]+)\.deleteMany\(\)/g)].map((match) => match[1]),
  );
}

describe("the dev seed's wipe list", () => {
  it("finds both lists at all — a rename must not make this test vacuous", () => {
    expect(writtenModels().size).toBeGreaterThan(5);
    expect(wipedModels().size).toBeGreaterThan(5);
  });

  it("clears every model the seed writes", () => {
    const wiped = wipedModels();
    const missing = [...writtenModels()].filter((model) => !wiped.has(model)).sort();
    expect(missing).toEqual([]);
  });
});

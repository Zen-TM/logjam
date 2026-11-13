import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SEED_NAMES } from "../../prisma/seedNames";

// The Playwright specs find seeded rows by the name they show. Each such name
// is declared once in prisma/seedNames.ts; the seed writes the row from it and
// the specs look the row up with it. A spec (or the seed) that writes the
// string out again can drift from the other, and CI finds out fifteen minutes
// later in a spec far from the seed.
//
// Mutation that turns it red: write `"Hidden Slot"` as a literal in a spec or
// in seed.ts instead of SEED_NAMES.hiddenSlot, or add a SEED_NAMES entry no
// spec uses.
const E2E = join(__dirname, "../../../frontend/e2e");
const specs = readdirSync(E2E)
  .filter((f) => f.endsWith(".spec.ts"))
  .map((f) => [f, readFileSync(join(E2E, f), "utf8")] as const);
const seed = readFileSync(join(__dirname, "../../prisma/seed.ts"), "utf8");

// A quoted string equal to `name`: the spec wrote it out instead of importing.
const quoted = (text: string, name: string) =>
  [`"${name}"`, `'${name}'`, `\`${name}\``].some((q) => text.includes(q)) ||
  text.includes(`/^${name}`);

describe("seeded row names are declared once", () => {
  const entries = Object.entries(SEED_NAMES);

  it("finds the specs and names it is meant to scan", () => {
    expect(specs.length).toBeGreaterThanOrEqual(10);
    expect(entries.length).toBeGreaterThanOrEqual(8);
  });

  it.each(entries)("%s is not written out in a spec", (_key, name) => {
    for (const [file, text] of specs) {
      expect(
        quoted(text, name),
        `${file} writes "${name}" out: import SEED_NAMES from api/prisma/seedNames.ts and use its key`,
      ).toBe(false);
    }
  });

  it.each(entries)(
    "%s is written by the seed from the constant",
    (key, name) => {
      expect(
        quoted(seed, name),
        `api/prisma/seed.ts writes "${name}" out: use SEED_NAMES.${key}`,
      ).toBe(false);
      expect(seed, `seed.ts never uses SEED_NAMES.${key}`).toContain(
        `SEED_NAMES.${key}`,
      );
    },
  );

  it.each(entries)("%s is looked up by a spec", (key) => {
    expect(
      specs.some(([, text]) => text.includes(`SEED_NAMES.${key}`)),
      `no spec uses SEED_NAMES.${key}: delete it from prisma/seedNames.ts`,
    ).toBe(true);
  });
});

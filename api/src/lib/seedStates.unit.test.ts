import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SEED_EDGE_USERS } from "../../prisma/seedIds";
import { SEED_STATES } from "../../prisma/seedStates";

// The list of states the seed must hold (prisma/seedStates.ts) is checked
// against the seeded database by src/__tests__/seedStates.test.ts. This holds
// the list itself, which that test cannot: a state with no name to report, two
// with one name, and an edge user the seed never writes.
//
// Mutation that turns it red: give two states one name, drop a state's `sql`
// so it is not a SELECT, or delete a SEED_EDGE_USERS account from seed.ts.
const seed = readFileSync(join(__dirname, "../../prisma/seed.ts"), "utf8");

describe("the states the seed must hold", () => {
  it("lists them, each once, as a query", () => {
    expect(SEED_STATES.length).toBeGreaterThanOrEqual(70);
    const names = SEED_STATES.map((s) => s.name);
    expect(
      names.filter((n, i) => names.indexOf(n) !== i),
      "two states share a name: the failure would not say which is missing",
    ).toEqual([]);
    for (const { name, sql } of SEED_STATES) {
      expect(sql.trimStart(), `state "${name}" is not a SELECT`).toMatch(
        /^SELECT 1 FROM /,
      );
    }
  });

  it.each(Object.keys(SEED_EDGE_USERS))(
    "the seed writes the %s user",
    (key) => {
      expect(
        seed,
        `SEED_EDGE_USERS.${key} is declared in prisma/seedIds.ts but prisma/seed.ts never creates that user`,
      ).toContain(`SEED_EDGE_USERS.${key}`);
    },
  );
});

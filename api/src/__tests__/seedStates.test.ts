import { describe, it, expect } from "vitest";
import prisma from "../services/prisma";
import { SEED_STATES } from "../../prisma/seedStates";

// The seed has to hold the states the screens must handle (an account with
// nothing, work in flight, a name written right to left, ...): prisma/
// seedStates.ts lists them, each with a query that finds its row. This runs
// every query against the seeded database and names every state with none.
//
// Mutation that turns it red: delete a row from prisma/seed.ts (the `running`
// export, or the user `dave`) and re-seed, or add a state to SEED_STATES that
// the seed writes no row for.
describe("the seeded database holds every state in prisma/seedStates.ts", () => {
  it("has a row for each state", async () => {
    const missing: string[] = [];
    for (const { name, sql } of SEED_STATES) {
      try {
        const rows = await prisma.$queryRawUnsafe<unknown[]>(sql);
        if (rows.length === 0) missing.push(name);
      } catch (err) {
        // A query the schema rejects is a state nothing can vouch for.
        missing.push(`${name} (its query failed: ${(err as Error).message})`);
      }
    }
    expect(
      missing,
      "the seed holds no row for these states: write one in prisma/seed.ts, or delete the state from prisma/seedStates.ts if the product no longer has it",
    ).toEqual([]);
  });
});

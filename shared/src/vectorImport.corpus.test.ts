// Every file in __fixtures__/vector-corpus goes through parseVectorImport and
// its result (or the error a user would read) is compared with the neighbouring
// `.golden` file. The files are hand-written in each producer's dialect with
// invented geometry (no recorded track, no user's file); only the producers'
// layouts are real. `refuse-*` files are ones the importer should turn away
// with a plain sentence.
//
// A parser change that alters any of these shows up as a diff in the golden.
// After an intended change: `npx vitest run src/vectorImport.corpus.test.ts -u`
// and read the golden diff.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseVectorImport } from "./vectorImport";

const dir = join(__dirname, "__fixtures__", "vector-corpus");
const inputs = readdirSync(dir).filter((f) => !f.endsWith(".golden"));

function outcome(file: string): unknown {
  try {
    return parseVectorImport(file, readFileSync(join(dir, file), "utf8"));
  } catch (err) {
    return { error: (err as Error).message };
  }
}

describe("vector import corpus", () => {
  it("has inputs", () => {
    expect(inputs.length).toBeGreaterThan(10);
  });

  it.each(inputs)("%s", async (file) => {
    await expect(
      JSON.stringify(outcome(file), null, 2) + "\n",
    ).toMatchFileSnapshot(join(dir, `${file}.golden`));
  });
});

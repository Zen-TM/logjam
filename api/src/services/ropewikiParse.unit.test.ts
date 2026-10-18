// Golden test for the RopeWiki Special:Ask parser on the odd rows of the live
// export. Both fixtures are rows of RopeWiki's public NSW export (CC BY-NC-SA,
// ropewiki.com), copied unchanged: ropewiki-nsw-sample.csv is three of them,
// ropewiki-nsw-tricky.csv fifteen picked for their shape (ranges, "6r+2j",
// nested <i> tags, missing grade, coordinates or rappels, miles and feet,
// a comma in the name). Shapes the export has not produced (clock times,
// "2 days", a bad or duplicate PAGEID) are not covered by those two:
// ropewiki-synthetic-shapes.csv holds them, made up row by row (names, ids
// and values are invented, in the export's column layout), so its golden pins
// the parser's reading of a shape, not anything RopeWiki publishes.
//
// The goldens are plain-text JSON (extension .golden) so the formatter leaves them alone.
// Regenerate the golden after an intended parser change with
// `npx vitest run -c vitest.unit.config.ts src/services/ropewikiParse.unit.test.ts -u`
// and read the diff: it is the list of what changed for users.
// Mutation that turns it red: changing the feet factor 0.3048 in
// parseLongestRappel, or dropping the tag strip in parseRating.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/env", () => ({ getEnv: vi.fn(() => ({})) }));
vi.mock("../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  safeErrorForLog: (err: unknown) => err,
}));

import { parseRopeWikiCsv } from "./ropewiki";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", name), "utf8");
const golden = (name: string) => join(__dirname, "__fixtures__", name);

describe("parseRopeWikiCsv corpus", () => {
  it("parses the tricky rows as the golden says", async () => {
    const result = parseRopeWikiCsv(fixture("ropewiki-nsw-tricky.csv"));
    await expect(JSON.stringify(result, null, 2) + "\n").toMatchFileSnapshot(
      golden("ropewiki-nsw-tricky.golden"),
    );
  });

  it("parses the synthetic shapes as the golden says", async () => {
    const result = parseRopeWikiCsv(fixture("ropewiki-synthetic-shapes.csv"));
    await expect(JSON.stringify(result, null, 2) + "\n").toMatchFileSnapshot(
      golden("ropewiki-synthetic-shapes.golden"),
    );
  });

  it("parses the real export sample as the golden says", async () => {
    const result = parseRopeWikiCsv(fixture("ropewiki-nsw-sample.csv"));
    await expect(JSON.stringify(result, null, 2) + "\n").toMatchFileSnapshot(
      golden("ropewiki-nsw-sample.golden"),
    );
  });
});

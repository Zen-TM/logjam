// Golden test for the RopeWiki Special:Ask parser on the shapes the live export
// produces. The fixture is hand-written in the export's layout: the canyon
// names are published RopeWiki page titles prefixed "Corpus" so none can be
// mistaken for a real page; every other cell is invented. The shipped sample
// (ropewiki-nsw-sample.csv) is a real export and is checked beside it.
//
// The goldens are plain-text JSON (extension .golden) so the formatter leaves them alone.
// Regenerate the golden after an intended parser change with
// `npx vitest run -c vitest.unit.config.ts src/services/ropewikiParse.unit.test.ts -u`
// and read the diff: it is the list of what changed for users.
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

  it("parses the real export sample as the golden says", async () => {
    const result = parseRopeWikiCsv(fixture("ropewiki-nsw-sample.csv"));
    await expect(JSON.stringify(result, null, 2) + "\n").toMatchFileSnapshot(
      golden("ropewiki-nsw-sample.golden"),
    );
  });
});

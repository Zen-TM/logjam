import { afterEach, describe, expect, it } from "vitest";

import { detectPlaceColumns } from "./placeColumns";
import { parseCsv } from "./parseCsv";
import {
  preparePlaceRows,
  prepareTripRows,
  skippedRowLine,
  skippedRowsNote,
} from "./prepareRows";

const languageOf = globalThis as { LOGJAM_LANGUAGE?: string };
afterEach(() => {
  delete languageOf.LOGJAM_LANGUAGE;
});

// Mutation that turns these red: in preparePlaceRows or prepareTripRows push
// `skippedRowLine(...)` onto `warnings` instead of `{ line, reason }` onto
// `skippedRows`: the dropped row lands in "left empty" and the list is empty.
// In the pseudo-language no sentence ends in English, so a split that read the
// text back (ADR 0050, Update rule 2) would put every dropped row there.
describe("dropped rows, in a language other than English", () => {
  const csv = (text: string) =>
    parseCsv(new File([text], "a.csv", { type: "text/csv" }));

  it("keeps a dropped place row apart from a field left empty", async () => {
    const { headers, rows, lines } = await csv(
      [
        "name,latitude,longitude,attr:aca_water",
        "Fine,-33,150,C2",
        "Bad,x,150,",
        "Odd,-33,150,D",
      ].join("\n"),
    );
    languageOf.LOGJAM_LANGUAGE = "en-XA";
    const { warnings, skippedRows } = preparePlaceRows(
      rows,
      detectPlaceColumns(headers),
      lines,
    );
    expect(skippedRows).toEqual([
      { line: 3, reason: { kind: "latitude", raw: "x" } },
    ]);
    expect(warnings).toHaveLength(1);
    expect(skippedRowsNote(skippedRows)).toMatch(/⟦.*3.*⟧/);
    expect(skippedRowLine(skippedRows[0])).toMatch(/⟦.*3.*⟧/);
  });

  it("keeps a dropped trip row apart from a field left empty", async () => {
    const { headers, rows, lines } = await csv(
      [
        "place,date,pitches",
        "A,2024-01-02,3",
        "B,someday,2",
        "C,2024-01-03,x",
      ].join("\n"),
    );
    languageOf.LOGJAM_LANGUAGE = "en-XA";
    const { warnings, skippedRows } = prepareTripRows({
      headers,
      rows,
      lines,
      tripAssignments: { place: "name", date: "date", pitches: "new-cf" },
      tripNewCfForms: { pitches: { label: "Pitches", type: "integer" } },
      customFieldDefs: [],
      dateFormat: "YYYY-MM-DD",
    });
    expect(skippedRows).toEqual([
      { line: 3, reason: { kind: "date", raw: "someday" } },
    ]);
    expect(warnings).toHaveLength(1);
    expect(skippedRowsNote(skippedRows)).toMatch(/⟦.*3.*⟧/);
  });
});

describe("the confirm step's line about dropped rows", () => {
  it("says which rows it will skip", () => {
    expect(skippedRowsNote([{ line: 4, reason: { kind: "name" } }])).toBe(
      "1 row can't be read and will be skipped (row 4).",
    );
    expect(
      skippedRowsNote([
        { line: 4, reason: { kind: "name" } },
        { line: 9, reason: { kind: "name" } },
      ]),
    ).toBe("2 rows can't be read and will be skipped (rows 4, 9).");
    expect(skippedRowsNote([])).toBe("");
  });

  it("lists a dropped row as it always has", () => {
    expect(
      skippedRowLine({ line: 4, reason: { kind: "latitude", raw: "x" } }),
    ).toBe('Row 4: latitude "x" couldn\'t be read — skipped');
  });
});

// Mutation: number rows `at + 2` in parseCsv again, or stop counting title and
// blank lines.
describe("parseCsv's line numbers", () => {
  const file = (text: string) =>
    new File([text], "a.csv", { type: "text/csv" });

  it("counts title lines, blank lines and a quoted cell's own breaks", async () => {
    const parsed = await parseCsv(
      file(
        'My canyons\nname,latitude,longitude\n\nA,-33,150\n\n\n"B\nB",-34,151\nC,-35,152\n',
      ),
    );
    expect(parsed.rows.map((r) => r.name)).toEqual(["A", "B\nB", "C"]);
    expect(parsed.lines).toEqual([4, 7, 9]);
  });

  it("does not read a line of only commas as a row", async () => {
    const parsed = await parseCsv(
      file("name,latitude,longitude\nA,-33,150\n,,\nB,-34,151\n"),
    );
    expect(parsed.rows.map((r) => r.name)).toEqual(["A", "B"]);
    expect(parsed.lines).toEqual([2, 4]);
  });
});

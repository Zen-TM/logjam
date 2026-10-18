// Golden corpus for the CSV import: each file in __fixtures__/corpus goes
// through the steps UnifiedImportDialog runs (parse, kind detection, column
// roles, date format, row preparation, name matching) and the outcome is
// compared with the neighbouring `.golden` file, so a change that breaks a
// real-world shape shows as a diff.
//
// The files are invented, in the layouts real users bring: the maintainer's
// own spreadsheet shapes, an Excel "CSV UTF-8" export, a semicolon export,
// coordinates in other notations, a Google My Maps export, other header
// words, an extra title row. Canyon names are published ones (the seed's);
// notes, parties and dates are made up. Where the importer turns a shape away,
// the golden says so (`blocked`): that is a finding, not a pass.
//
// The row work, the decision words and the zero-row errors are csvImport/
// prepareRows.ts, the code the dialog calls; what stays here is the order the
// dialog runs them in and the `blocked` labels. After an intended change:
//   npx vitest run src/csvImport/importCorpus.test.ts -u
// and read the golden diff.
//
// Mutation that turns it red: changing the `rowIndex + 2` line numbering in
// prepareRows.ts, or making detectDateFormat ignore a sample (the goldens'
// warnings and dateFormat change).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchPlace, type MatchCandidate } from "@logjam/shared";

import { detectColumns } from "./detectColumns";
import { detectDateFormat } from "./detectDateFormat";
import { detectFileKind } from "./detectFileKind";
import { detectPlaceColumns, REQUIRED_ROLES } from "./placeColumns";
import { parseCsv } from "./parseCsv";
import {
  dateSamples,
  NO_PLACE_ROWS_ERROR,
  NO_TRIP_ROWS_ERROR,
  placeRowDecision,
  preparePlaceRows,
  prepareTripRows,
  tripRowDecision,
} from "./prepareRows";

// A signed-in user's own places, as GET /places returns them (the dialog
// matches nothing else): the seed's Blue Mountains places alice owns
// (api/prisma/seed.ts), names, coordinates and altNames copied by hand, with
// its two "Rocky Creek Canyon"s, which a logbook has to cope with. Not bound to
// the seed: a made-up list would serve as well.
const PLACES: MatchCandidate[] = [
  ["Grand Canyon", [], -33.6563, 150.3179],
  ["Claustral Canyon", [], -33.5603, 150.4033],
  ["Empress Falls", ["Valley-of-the-Waters"], -33.72, 150.3625],
  ["Butterbox Canyon", ["Mt Hay"], -33.6304, 150.397],
  ["Rocky Creek Canyon", [], -33.2878, 150.2932],
  ["Rocky Creek Canyon", [], -33.4487, 150.3311],
  ["Wollangambe One", [], -33.4888, 150.3587],
  ["Wollangambe Crater", [], -33.4602, 150.2588],
  ["Jugglers Canyon", ["Pilcher"], -33.6592, 150.3294],
  ["Yileen Canyon", [], -33.5666, 150.3295],
  [
    "Serendipity Canyon",
    ["Why Don't We Do It In The Road"],
    -33.4947,
    150.3812,
  ],
  ["Sarcophagus Canyon", [], -33.5693, 150.3235],
  ["Du Faur Creek", ["Clatterteeth"], -33.5153, 150.3343],
  ["Heart Attack Canyon", [], -33.2383, 150.3029],
  ["Bowens Creek North (Lower)", ["Gobsmacker"], -33.5215, 150.3932],
].map(([name, altNames, latitude, longitude], i) => ({
  id: `p${i + 1}`,
  name: name as string,
  altNames: altNames as string[],
  latitude: latitude as number,
  longitude: longitude as number,
}));

const nameOf = (id: string) => PLACES.find((p) => p.id === id)?.name ?? id;

const root = join(__dirname, "__fixtures__", "corpus");
const inputs = ["places", "logbooks"].flatMap((dir) =>
  readdirSync(join(root, dir))
    .filter((f) => f.endsWith(".csv"))
    .map((f) => `${dir}/${f}`),
);

function matchSummary(result: ReturnType<typeof matchPlace>) {
  return {
    confidence: result.confidence,
    best: result.best ? nameOf(result.best.candidate.id) : null,
    candidates: result.candidates.map((c) => nameOf(c.candidate.id)),
  };
}

async function runImport(path: string): Promise<unknown> {
  const bytes = readFileSync(join(root, path));
  const parsed = await parseCsv(new File([bytes], path, { type: "text/csv" }));
  const kind = detectFileKind(parsed.headers);
  const base = {
    headers: parsed.headers,
    dataRows: parsed.rows.length,
    parseErrors: parsed.parseErrors,
    kind,
  };
  if (parsed.headers.length === 0 || parsed.rows.length === 0)
    return { ...base, blocked: "no data rows" };
  if (kind === "unknown")
    return { ...base, blocked: "not a place list or logbook" };

  if (kind === "place") {
    const assignments = detectPlaceColumns(parsed.headers);
    const assigned = new Set(Object.values(assignments));
    const missing = REQUIRED_ROLES.filter((r) => !assigned.has(r));
    if (missing.length > 0)
      return {
        ...base,
        assignments,
        blocked: `no column for ${missing.join(", ")}`,
      };
    const prepared = preparePlaceRows(parsed.rows, assignments);
    if (prepared.rows.length === 0)
      return {
        ...base,
        assignments,
        ...prepared,
        blocked: NO_PLACE_ROWS_ERROR,
      };
    const seen = new Set<string>();
    const matches: Record<string, unknown>[] = [];
    for (const row of prepared.rows) {
      const key = row.sourceName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const result = matchPlace(
        {
          name: row.sourceName,
          altNames: row.input.altNames,
          latitude: row.input.latitude,
          longitude: row.input.longitude,
        },
        PLACES,
      );
      matches.push({
        name: row.sourceName,
        decision: placeRowDecision(result),
        ...matchSummary(result),
      });
    }
    return { ...base, assignments, ...prepared, matches };
  }

  const assignments = detectColumns(parsed.headers, []);
  const roles = Object.values(assignments);
  if (!roles.includes("name") || !roles.includes("date"))
    return { ...base, assignments, blocked: "no place-name or date column" };
  const dateHeader = parsed.headers.find((h) => assignments[h] === "date");
  const { format, ambiguous } = detectDateFormat(
    dateSamples(parsed.rows, dateHeader),
  );
  const prepared = prepareTripRows({
    headers: parsed.headers,
    rows: parsed.rows,
    tripAssignments: assignments,
    tripNewCfForms: {},
    customFieldDefs: [],
    dateFormat: format,
  });
  if (prepared.rows.length === 0)
    return {
      ...base,
      assignments,
      dateFormat: format,
      ambiguousDates: ambiguous,
      ...prepared,
      blocked: NO_TRIP_ROWS_ERROR,
    };
  const seen = new Set<string>();
  const matches: Record<string, unknown>[] = [];
  for (const row of prepared.rows) {
    const key = row.sourcePlaceName.toLowerCase();
    if (!row.sourcePlaceName || seen.has(key)) continue;
    seen.add(key);
    const result = matchPlace({ name: row.sourcePlaceName }, PLACES);
    matches.push({
      name: row.sourcePlaceName,
      decision: tripRowDecision(result),
      ...matchSummary(result),
    });
  }
  return {
    ...base,
    assignments,
    dateFormat: format,
    ambiguousDates: ambiguous,
    ...prepared,
    matches,
  };
}

describe("CSV import corpus", () => {
  it("has inputs", () => {
    expect(inputs.length).toBeGreaterThan(10);
  });

  it.each(inputs)("%s", async (path) => {
    await expect(
      JSON.stringify(await runImport(path), null, 2) + "\n",
    ).toMatchFileSnapshot(join(root, `${path}.golden`));
  });
});

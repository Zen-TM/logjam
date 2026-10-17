import { describe, it, expect } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { API_URL, CANYON_TYPE_ID } from "./_actors";

// What Logjam Web's CSV import sends, posted to the API: the rows are the
// importer's own output for the corpus files, read from the goldens in
// frontend/src/csvImport/__fixtures__/corpus (the one copy of that output; see
// importCorpus.test.ts there). A change to the importer that sends something
// the API refuses, or an API change that refuses what the importer sends,
// fails here. Requires `make dev` (AUTH_MODE=fake; requests = seeded alice).
const AUTH = { Authorization: "Bearer fake-token" } as const;
const CORPUS = join(
  __dirname,
  "../../../frontend/src/csvImport/__fixtures__/corpus",
);
const TAG = `corpus-${Date.now()}`;
// One prefix per file: two files carry the same canyon at the same spot, and a
// repeated name at one spot folds into the first row instead of being created.
const prefix = (file: string) => `${TAG} ${file.split("/").pop()}`;

type Golden = {
  rows: {
    sourceName?: string;
    input?: Record<string, unknown>;
    sourcePlaceName?: string;
    date?: string;
    notes?: string | null;
    types?: string[];
    customFields?: Record<string, unknown>;
  }[];
};

const golden = (path: string): Golden =>
  JSON.parse(readFileSync(join(CORPUS, `${path}.golden`), "utf8")) as Golden;

describe("import corpus → POST /places/bulk (fake auth = alice)", () => {
  for (const file of [
    "places/maintainer-shape.csv",
    "places/excel-utf8-bom-crlf.csv",
  ]) {
    it(`accepts every prepared row of ${file}, with its field values`, async () => {
      const rows = golden(file).rows;
      // Prefixed so nothing merges into the seed's own Claustral Canyon etc.
      const res = await request(API_URL)
        .post("/places/bulk")
        .set(AUTH)
        .send({
          placeTypeId: CANYON_TYPE_ID,
          importBatchId: randomUUID(),
          rows: rows.map((row) => ({
            data: {
              ...row.input,
              name: `${prefix(file)} ${row.sourceName}`,
            },
            resolution: { kind: "create" },
          })),
        });
      expect(res.status).toBe(200);
      expect(res.body.errors).toEqual([]);
      expect(res.body.created).toBe(rows.length);

      const list = await request(API_URL).get("/places").set(AUTH);
      for (const row of rows) {
        const stored = (
          list.body as { name: string; notes: string | null }[]
        ).find((p) => p.name === `${prefix(file)} ${row.sourceName}`);
        expect(stored, row.sourceName).toBeDefined();
        expect(stored?.notes ?? null).toBe(row.input?.notes ?? null);
      }
    });
  }

  it("keeps the maintainer's grades and quality on the stored place", async () => {
    const claustral = golden("places/maintainer-shape.csv").rows[0];
    const list = await request(API_URL).get("/places").set(AUTH);
    const stored = (
      list.body as { name: string; fieldValues: Record<string, unknown> }[]
    ).find(
      (p) =>
        p.name ===
        `${prefix("places/maintainer-shape.csv")} ${claustral.sourceName}`,
    );
    expect(stored?.fieldValues).toMatchObject({
      v_grade: 3,
      a_grade: 3,
      commitment: 3,
      quality: 4.9,
      num_abseils: 6,
      longest_abseil: 15,
      hours: 9,
    });
  });
});

describe("import corpus → POST /trips/bulk (fake auth = alice)", () => {
  it("accepts every prepared row of the maintainer's logbook, notes intact", async () => {
    const rows = golden("logbooks/maintainer-logbook.csv").rows;
    const res = await request(API_URL)
      .post("/trips/bulk")
      .set(AUTH)
      .send({
        importBatchId: `${TAG}-trips`,
        // A place-less row, as the dialog sends an unmatched name.
        trips: rows.map((row) => ({
          placeId: null,
          sourcePlaceName: row.sourcePlaceName,
          displayName: `${TAG} ${row.sourcePlaceName}`,
          types: row.types,
          date: row.date,
          notes: row.notes,
          customFields: row.customFields,
        })),
      });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.imported).toBe(rows.length);

    // The note with quotes and a line break comes back as it went in.
    const yileen = rows.find((r) => r.sourcePlaceName === "Yileen");
    const list = await request(API_URL)
      .get("/trips")
      .query({ search: `${TAG} Yileen` })
      .set(AUTH);
    expect(
      (list.body as { notes: string | null }[]).map((t) => t.notes),
    ).toContain(yileen?.notes);
  });
});

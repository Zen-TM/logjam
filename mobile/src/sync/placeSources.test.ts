// A place's source links through the phone: the mirror keeps them, an edit made
// offline queues them whole, and a pull of the same place gives them back. Real
// SQLite, as the claims are about rows.
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanSources,
  setFieldValues,
  SOURCES_FIELD_KEY,
  sourceRows,
  type SyncDeltaPlaceRow,
} from "@logjam/shared";

const { createSchemaSql } = await import("./mirrorSchema");

let sqlite = new DatabaseSync(":memory:");

const db = {
  runAsync: (sql: string, ...params: unknown[]) => {
    sqlite.prepare(sql).run(...(params as never[]));
    return Promise.resolve({ changes: 0, lastInsertRowId: 0 });
  },
  getFirstAsync: (sql: string, ...params: unknown[]) =>
    Promise.resolve(sqlite.prepare(sql).get(...(params as never[])) ?? null),
  getAllAsync: (sql: string, ...params: unknown[]) =>
    Promise.resolve(sqlite.prepare(sql).all(...(params as never[]))),
};

vi.mock("./syncDb", () => ({
  getSyncDb: () => Promise.resolve(db),
  notifyMirrorChanged: () => {},
  withSyncTransaction: async (_db: unknown, task: () => Promise<void>) => {
    await task();
  },
}));
vi.mock("./mediaSyncBridge", () => ({ scheduleMutationSync: () => {} }));
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: () => Promise.resolve(),
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    }),
}));

const { createPlaceLocal, updatePlaceLocal } = await import("./outbox");
const { getMirrorPlace, upsertPlace } = await import("./mirrorStore");

const TYPE = "b0000000-0000-4000-8000-000000000001";

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(createSchemaSql("mirror"));
  sqlite.exec(createSchemaSql("local"));
});

const ops = () =>
  sqlite.prepare("SELECT op, fields_json FROM outbox ORDER BY seq").all() as {
    op: string;
    fields_json: string;
  }[];

const row = (fieldValues: Record<string, unknown>) =>
  ({
    id: "p1",
    ownerId: "u",
    syncRole: "owner",
    name: "n",
    altNames: [],
    latitude: -33.5,
    longitude: 150.4,
    placeTypeId: TYPE,
    notes: null,
    elevation: null,
    fieldValues,
    ropeWikiId: null,
    forkedFromId: null,
    gaugeId: null,
    createdAt: "",
    updatedAt: "",
  }) as SyncDeltaPlaceRow;

/** What PlaceEditSheet queues: the stored values with the form's sources over them. */
const withSources = (
  stored: Record<string, unknown>,
  rows: { label: string; url: string }[],
) => {
  const cleaned = cleanSources(rows);
  if ("error" in cleaned) throw new Error(cleaned.error);
  return setFieldValues(stored, { [SOURCES_FIELD_KEY]: cleaned.sources });
};

describe("a place's source links", () => {
  // Mutation: drop `fieldValues` from `PLACE_UPDATE_COLUMNS` in outbox.ts, and
  // neither the mirror nor the queued op carries the edit.
  it("queues an offline edit over the stored values and keeps the mirror in step", async () => {
    await upsertPlace(db as never, row({ grade: 3 }), []);
    const place = await getMirrorPlace("p1");
    const next = withSources(place?.fieldValues ?? {}, [
      { label: " Guide ", url: "https://a.example/g" },
    ]);
    await updatePlaceLocal("p1", { fieldValues: next });

    expect(JSON.parse(ops()[0].fields_json).fieldValues).toEqual({
      grade: 3,
      [SOURCES_FIELD_KEY]: [["Guide", "https://a.example/g"]],
    });
    const after = await getMirrorPlace("p1");
    expect(sourceRows(after?.fieldValues)).toEqual([
      { label: "Guide", url: "https://a.example/g" },
    ]);
    expect(after?.fieldValues).toMatchObject({ grade: 3 });
  });

  // Mutation: make `setFieldValues` keep a null instead of removing the key,
  // and the last source's removal is queued as `_sources: null`.
  it("queues the removal of the last source as a missing key", async () => {
    await upsertPlace(
      db as never,
      row({ [SOURCES_FIELD_KEY]: [["Guide", "https://a.example"]], grade: 3 }),
      [],
    );
    const place = await getMirrorPlace("p1");
    await updatePlaceLocal("p1", {
      fieldValues: withSources(place?.fieldValues ?? {}, []),
    });
    expect(JSON.parse(ops()[0].fields_json).fieldValues).toEqual({ grade: 3 });
    expect(sourceRows((await getMirrorPlace("p1"))?.fieldValues)).toEqual([]);
  });

  it("creates a place with its sources in the queued op", async () => {
    const id = await createPlaceLocal({
      name: "n",
      latitude: -33.5,
      longitude: 150.4,
      placeTypeId: TYPE,
      fieldValues: withSources({}, [{ label: "A", url: "https://a.example" }]),
    });
    expect(sourceRows((await getMirrorPlace(id))?.fieldValues)).toEqual([
      { label: "A", url: "https://a.example" },
    ]);
    expect(JSON.parse(ops()[0].fields_json).fieldValues).toEqual({
      [SOURCES_FIELD_KEY]: [["A", "https://a.example"]],
    });
  });

  it("gets a pulled place's sources back from the mirror", async () => {
    await upsertPlace(
      db as never,
      row({ [SOURCES_FIELD_KEY]: [["RopeWiki", "https://ropewiki.com/x"]] }),
      [],
    );
    expect(sourceRows((await getMirrorPlace("p1"))?.fieldValues)).toEqual([
      { label: "RopeWiki", url: "https://ropewiki.com/x" },
    ]);
  });
});

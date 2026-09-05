import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TripLogCustomFieldDef } from "@logjam/shared";

// Definitions are rows in the local mirror now, written through the outbox.
// These tests hold the two properties that change bought: every path works with
// the API layer untouched (so it works for a guest, and offline), and the WRITES
// are per-row rather than a whole list (so two devices merge instead of one
// erasing the other).

type DefRow = {
  id: string;
  entity: string;
  key: string;
  label: string;
  type: string;
  min: number | null;
  max: number | null;
  position: number;
};

let defRows: DefRow[] = [];
let trips: { id: string; customFields: Record<string, unknown> }[] = [];
let places: {
  id: string;
  syncRole: string;
  fieldValues: Record<string, unknown>;
}[] = [];

const created: { entity: string; def: TripLogCustomFieldDef }[] = [];
const updated: { id: string; fields: Record<string, unknown> }[] = [];
const deleted: string[] = [];
const tripUpdates: { id: string; fields: Record<string, unknown> }[] = [];
const placeUpdates: { id: string; fields: Record<string, unknown> }[] = [];

vi.mock("../sync/mirrorStore", () => ({
  listMirrorCustomFieldDefs: () => Promise.resolve(defRows),
  listMirrorTrips: () => Promise.resolve(trips),
  listMirrorPlaces: () => Promise.resolve(places),
}));
vi.mock("../sync/outbox", () => ({
  createCustomFieldDefLocal: (draft: { entity: string; def: TripLogCustomFieldDef }) => {
    created.push(draft);
    return Promise.resolve("new-id");
  },
  updateCustomFieldDefLocal: (id: string, fields: Record<string, unknown>) => {
    updated.push({ id, fields });
    return Promise.resolve();
  },
  deleteCustomFieldDefLocal: (id: string) => {
    deleted.push(id);
    return Promise.resolve();
  },
  updateTripLocal: (id: string, fields: Record<string, unknown>) => {
    tripUpdates.push({ id, fields });
    return Promise.resolve();
  },
  updatePlaceLocal: (id: string, fields: Record<string, unknown>) => {
    placeUpdates.push({ id, fields });
    return Promise.resolve();
  },
}));

// The API layer is mocked to THROW. Nothing in this file may reach it — that is
// the assertion the whole suite rests on, and a rejection is louder than a spy.
vi.mock("../api/queries", () => ({
  fetchCurrentUser: () => Promise.reject(new Error("definitions must not fetch")),
  updateCustomFieldDefs: () => Promise.reject(new Error("definitions must not PATCH")),
}));

const { countFieldValues, loadFieldDefs, removeFieldDef, saveFieldDefs } =
  await import("./fieldDefsStore");

const water: TripLogCustomFieldDef = { key: "water", label: "Water level", type: "string" };
const party: TripLogCustomFieldDef = { key: "party", label: "Party size", type: "integer" };

function row(def: TripLogCustomFieldDef, entity: string, position = 0): DefRow {
  return {
    id: `row-${def.key}`,
    entity,
    key: def.key,
    label: def.label,
    type: def.type,
    min: def.min ?? null,
    max: def.max ?? null,
    position,
  };
}

beforeEach(() => {
  defRows = [];
  trips = [];
  places = [];
  created.length = 0;
  updated.length = 0;
  deleted.length = 0;
  tripUpdates.length = 0;
  placeUpdates.length = 0;
});

describe("loadFieldDefs", () => {
  it("reads the mirror, scoped to one entity", async () => {
    defRows = [row(water, "tripLog", 0), row(party, "place", 0)];
    expect(await loadFieldDefs("tripLog")).toEqual([water]);
    expect(await loadFieldDefs("place")).toEqual([party]);
  });

  it("orders by position, not by insertion", async () => {
    defRows = [row(party, "tripLog", 1), row(water, "tripLog", 0)];
    expect((await loadFieldDefs("tripLog")).map((def) => def.key)).toEqual([
      "water",
      "party",
    ]);
  });

  it("drops a row that does not describe a usable field", async () => {
    defRows = [row(water, "tripLog"), { ...row(party, "tripLog", 1), type: "nonsense" }];
    expect(await loadFieldDefs("tripLog")).toEqual([water]);
  });
});

describe("saveFieldDefs", () => {
  it("adds a new field as a create, touching nothing else", async () => {
    defRows = [row(water, "tripLog", 0)];
    await saveFieldDefs("tripLog", [water, party]);
    expect(created).toEqual([{ entity: "tripLog", def: party }]);
    expect(updated).toEqual([]);
    expect(deleted).toEqual([]);
  });

  // The point of the row grain: a relabel writes ONE field of ONE row, so a
  // definition another device added between reads is not in the payload at all
  // and cannot be erased by this write.
  it("relabels in place, sending only the changed field", async () => {
    defRows = [row(water, "tripLog", 0)];
    await saveFieldDefs("tripLog", [{ ...water, label: "Flow" }]);
    expect(updated).toEqual([{ id: "row-water", fields: { label: "Flow" } }]);
    expect(created).toEqual([]);
  });

  it("writes nothing at all when the list is unchanged", async () => {
    defRows = [row(water, "tripLog", 0), row(party, "tripLog", 1)];
    await saveFieldDefs("tripLog", [water, party]);
    expect([...created, ...updated, ...deleted]).toEqual([]);
  });

  it("reorders by writing position", async () => {
    defRows = [row(water, "tripLog", 0), row(party, "tripLog", 1)];
    await saveFieldDefs("tripLog", [party, water]);
    expect(updated).toEqual([
      { id: "row-party", fields: { position: 0 } },
      { id: "row-water", fields: { position: 1 } },
    ]);
  });

  it("deletes a field the caller dropped", async () => {
    defRows = [row(water, "tripLog", 0), row(party, "tripLog", 1)];
    await saveFieldDefs("tripLog", [water]);
    expect(deleted).toEqual(["row-party"]);
  });

  it("leaves the other entity's definitions alone", async () => {
    defRows = [row(water, "tripLog", 0), row(party, "place", 0)];
    await saveFieldDefs("tripLog", []);
    expect(deleted).toEqual(["row-water"]);
  });
});

describe("countFieldValues", () => {
  it("counts trips carrying a value", async () => {
    trips = [
      { id: "t1", customFields: { water: "high" } },
      { id: "t2", customFields: {} },
    ];
    expect(await countFieldValues("tripLog", "water")).toBe(1);
  });

  // A sharee cannot strip the owner's values, so they must not be counted as
  // rows this delete will clear either — the number and the effect must agree.
  it("ignores places shared WITH this user", async () => {
    places = [
      { id: "c1", syncRole: "owner", fieldValues: { party: 3 } },
      { id: "c2", syncRole: "shared", fieldValues: { party: 4 } },
    ];
    expect(await countFieldValues("place", "party")).toBe(1);
  });
});

describe("removeFieldDef", () => {
  it("strips the value from every local trip, then deletes the definition", async () => {
    defRows = [row(water, "tripLog", 0)];
    trips = [
      { id: "t1", customFields: { water: "high", other: 1 } },
      { id: "t2", customFields: { other: 2 } },
    ];
    expect(await removeFieldDef("tripLog", "water")).toBe(1);
    expect(tripUpdates).toEqual([
      { id: "t1", fields: { customFields: { other: 1 } } },
    ]);
    expect(deleted).toEqual(["row-water"]);
  });

  // `_sources` is written only by the web, and it lives in the SAME object as
  // the field values now rather than beside them — so a strip that rebuilt
  // fieldValues from the user keys alone would silently drop it. That is a
  // sharper trap than before the rework, not a milder one.
  it("preserves the rest of a place's field values", async () => {
    defRows = [row(party, "place", 0)];
    places = [
      {
        id: "c1",
        syncRole: "owner",
        fieldValues: {
          _sources: [["Wiki", "http://x"]],
          party: 3,
          permit: "yes",
        },
      },
    ];
    expect(await removeFieldDef("place", "party")).toBe(1);
    expect(placeUpdates).toEqual([
      {
        id: "c1",
        fields: {
          fieldValues: {
            _sources: [["Wiki", "http://x"]],
            permit: "yes",
          },
        },
      },
    ]);
  });

  it("is a no-op on a definition that is already gone", async () => {
    expect(await removeFieldDef("tripLog", "water")).toBe(0);
    expect(deleted).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedCustomFieldDef } from "@logjam/shared";

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
  ownerId: string | null;
  placeTypeIds: string[];
  tripTypes: string[];
  appliesToAllTypes: boolean;
};

let defRows: DefRow[] = [];
let trips: { id: string; customFields: Record<string, unknown> }[] = [];
let places: {
  id: string;
  syncRole: string;
  fieldValues: Record<string, unknown>;
}[] = [];

const created: Record<string, unknown>[] = [];
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
  createCustomFieldDefLocal: (draft: Record<string, unknown>) => {
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

const water: ScopedCustomFieldDef = {
  key: "water",
  label: "Water level",
  type: "string",
  ownerId: "user-1",
  placeTypeIds: [],
  tripTypes: [],
  appliesToAllTypes: true,
};
const party: ScopedCustomFieldDef = {
  key: "party",
  label: "Party size",
  type: "integer",
  ownerId: "user-1",
  placeTypeIds: [],
  tripTypes: [],
  appliesToAllTypes: true,
};

function row(def: ScopedCustomFieldDef, entity: string, position = 0): DefRow {
  return {
    id: `row-${def.key}`,
    entity,
    key: def.key,
    label: def.label,
    type: def.type,
    min: def.min ?? null,
    max: def.max ?? null,
    position,
    // `??` would swallow the case this file exists for: a SYSTEM row's owner
    // is null, and null is exactly what `??` falls back from.
    ownerId: def.ownerId === undefined ? "user-1" : def.ownerId,
    placeTypeIds: def.placeTypeIds,
    tripTypes: def.tripTypes,
    appliesToAllTypes: def.appliesToAllTypes,
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

  it("carries each row's scoping, which is what the type-specific form reads", async () => {
    defRows = [
      {
        ...row(party, "place", 0),
        placeTypeIds: ["type-campsite"],
        appliesToAllTypes: false,
      },
    ];
    expect(await loadFieldDefs("place")).toEqual([
      { ...party, placeTypeIds: ["type-campsite"], appliesToAllTypes: false },
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
    expect(created).toEqual([
      {
        entity: "tripLog",
        def: party,
        placeTypeIds: party.placeTypeIds,
        tripTypes: party.tripTypes,
        appliesToAllTypes: party.appliesToAllTypes,
      },
    ]);
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

  // WITHOUT this, a field created on the phone reaches the server with no
  // scoping at all — `appliesToAllTypes` false and no types — and appears on no
  // form. The user made it from the campsite form and it is nowhere.
  it("carries the scoping on a create", async () => {
    const capacity: ScopedCustomFieldDef = {
      key: "capacity",
      label: "Capacity",
      type: "integer",
      placeTypeIds: ["type-campsite"],
      tripTypes: [],
      appliesToAllTypes: false,
    };
    await saveFieldDefs("place", [capacity]);
    expect(created).toEqual([
      {
        entity: "place",
        def: capacity,
        placeTypeIds: ["type-campsite"],
        tripTypes: [],
        appliesToAllTypes: false,
      },
    ]);
  });

  // A TRIP field is scoped by trip types (tags). Without them on the create and
  // on the patch, a field set up for packrafting reaches the server scoped to
  // nothing, or keeps its old tags after the user changed them.
  it("carries a trip field's trip types on a create and on a rescope", async () => {
    const flow: ScopedCustomFieldDef = {
      key: "flow",
      label: "Flow",
      type: "integer",
      placeTypeIds: [],
      tripTypes: ["packrafting"],
      appliesToAllTypes: false,
    };
    await saveFieldDefs("tripLog", [flow]);
    expect(created).toEqual([
      {
        entity: "tripLog",
        def: flow,
        placeTypeIds: [],
        tripTypes: ["packrafting"],
        appliesToAllTypes: false,
      },
    ]);

    created.length = 0;
    defRows = [row(flow, "tripLog", 0)];
    await saveFieldDefs("tripLog", [{ ...flow, tripTypes: ["packrafting", "bushwalking"] }]);
    expect(created).toEqual([]);
    expect(updated).toEqual([
      { id: "row-flow", fields: { tripTypes: ["packrafting", "bushwalking"] } },
    ]);
  });

  it("rescopes an existing field with a patch, not a recreate", async () => {
    defRows = [row(party, "place", 0)];
    await saveFieldDefs("place", [
      { ...party, appliesToAllTypes: false, placeTypeIds: ["type-canyon"] },
    ]);
    expect(created).toEqual([]);
    expect(updated).toEqual([
      {
        id: "row-party",
        fields: { appliesToAllTypes: false, placeTypeIds: ["type-canyon"] },
      },
    ]);
  });

  // Order is not meaningful in a scoping, so a reordered list is not a change —
  // writing one would queue a push on every save and conflict for nothing.
  it("does not rewrite a scoping whose ids only changed order", async () => {
    defRows = [
      row(
        { ...party, appliesToAllTypes: false, placeTypeIds: ["a", "b"] },
        "place",
        0,
      ),
    ];
    await saveFieldDefs("place", [
      { ...party, appliesToAllTypes: false, placeTypeIds: ["b", "a"] },
    ]);
    expect([...created, ...updated]).toEqual([]);
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

// A SYSTEM definition belongs to no account. The phone could not see that —
// the mirror threw `ownerId` away — so the editor offered Delete on a built-in
// field, and `removeFieldDefById` did its half FIRST: strip the value off every
// owned place carrying the key. The server then answered the definition delete
// with "already applied", so the field came back on the next pull and the
// values did not. Every star rating in an account, gone in two taps.
describe("a built-in definition is not the account's to change", () => {
  const builtIn: ScopedCustomFieldDef = {
    key: "quality",
    label: "Quality",
    type: "float",
    min: 1,
    max: 5,
    ownerId: null,
    placeTypeIds: ["type-canyon"],
    tripTypes: [],
    appliesToAllTypes: false,
  };

  it("refuses to delete one, before anything is stripped", async () => {
    defRows = [row(builtIn, "place", 0)];
    places = [
      { id: "p1", syncRole: "owner", fieldValues: { quality: 4 } },
      { id: "p2", syncRole: "owner", fieldValues: { quality: 5 } },
    ];
    await expect(removeFieldDef("place", "quality")).rejects.toThrow(/built-in/i);
    expect(placeUpdates, "no place may lose a value").toEqual([]);
    expect(deleted).toEqual([]);
  });

  // The whole-list save is the other way in: the editor hands over the list it
  // is holding, and a list that has simply lost a row means "delete it".
  it("is not deleted by a whole-list save that omits it", async () => {
    defRows = [row(builtIn, "place", 0)];
    places = [{ id: "p1", syncRole: "owner", fieldValues: { quality: 4 } }];
    await saveFieldDefs("place", []);
    expect(deleted).toEqual([]);
    expect(placeUpdates).toEqual([]);
  });

  it("is not renamed or rescoped by a whole-list save", async () => {
    defRows = [row(builtIn, "place", 0)];
    await saveFieldDefs("place", [
      { ...builtIn, label: "Mine now", appliesToAllTypes: true },
    ]);
    expect([...created, ...updated]).toEqual([]);
  });
});

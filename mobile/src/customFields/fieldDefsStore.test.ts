import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TripLogCustomFieldDef } from "@logjam/shared";

// A guest's definitions have no account behind them, so every one of these
// paths has to work with the API layer untouched — the assertions below check
// that as much as they check the storage.

const kv = new Map<string, string>();
const patched: { entity: string; defs: TripLogCustomFieldDef[] }[] = [];
const tripUpdates: { id: string; fields: Record<string, unknown> }[] = [];
const canyonUpdates: { id: string; fields: Record<string, unknown> }[] = [];
let trips: { id: string; customFields: Record<string, unknown> }[] = [];
let canyons: {
  id: string;
  syncRole: string;
  attributes: { sources?: [string, string][]; customFields?: Record<string, unknown> };
}[] = [];

vi.mock("../sync/syncDb", () => ({
  getSyncStateValue: (key: string) => Promise.resolve(kv.get(key) ?? null),
  setSyncStateValue: (key: string, value: string) => {
    kv.set(key, value);
    return Promise.resolve();
  },
  notifyMirrorChanged: () => {},
}));
vi.mock("../sync/mirrorStore", () => ({
  listMirrorTrips: () => Promise.resolve(trips),
  listMirrorCanyons: () => Promise.resolve(canyons),
}));
vi.mock("../sync/outbox", () => ({
  updateTripLocal: (id: string, fields: Record<string, unknown>) => {
    tripUpdates.push({ id, fields });
    return Promise.resolve();
  },
  updateCanyonLocal: (id: string, fields: Record<string, unknown>) => {
    canyonUpdates.push({ id, fields });
    return Promise.resolve();
  },
}));
vi.mock("../api/queries", () => ({
  customFieldDefsOf: (user: { uiPreferences?: Record<string, unknown> }, entity: string) =>
    user?.uiPreferences?.[
      entity === "tripLog" ? "tripLogCustomFields" : "canyonCustomFields"
    ] ?? [],
  fetchCurrentUser: () => Promise.reject(new Error("no account in this test")),
  updateCustomFieldDefs: (entity: string, defs: TripLogCustomFieldDef[]) => {
    patched.push({ entity, defs });
    return Promise.resolve({});
  },
  deleteCustomFieldDef: () => Promise.reject(new Error("account path not exercised")),
  getCustomFieldImpact: () => Promise.reject(new Error("account path not exercised")),
}));

const {
  adoptLocalFieldDefs,
  countFieldValues,
  mergeFieldDefs,
  parseFieldDefs,
  readLocalFieldDefs,
  removeFieldDef,
  saveFieldDefs,
} = await import("./fieldDefsStore");

const water: TripLogCustomFieldDef = { key: "water", label: "Water level", type: "string" };
const party: TripLogCustomFieldDef = { key: "party", label: "Party size", type: "integer" };

beforeEach(() => {
  kv.clear();
  patched.length = 0;
  tripUpdates.length = 0;
  canyonUpdates.length = 0;
  trips = [];
  canyons = [];
});

describe("parseFieldDefs", () => {
  it("reads nothing as no fields", () => {
    expect(parseFieldDefs(null)).toEqual([]);
    expect(parseFieldDefs("")).toEqual([]);
  });

  it("round-trips a stored list", () => {
    expect(parseFieldDefs(JSON.stringify([water, party]))).toEqual([water, party]);
  });

  // Falling back to [] would render as "you never made any fields", which the
  // user cannot tell apart from data loss — and the next save would write that
  // empty list back over the real one.
  it("throws on a corrupt list rather than reporting none", () => {
    expect(() => parseFieldDefs("{")).toThrow();
    expect(() => parseFieldDefs('[{"key":"x"}]')).toThrow(/Corrupt/);
    expect(() => parseFieldDefs('{"key":"x"}')).toThrow(/Corrupt/);
  });
});

describe("a guest's definitions", () => {
  it("save to the device, with no request", async () => {
    await saveFieldDefs("tripLog", "guest", [water]);
    expect(patched).toEqual([]);
    expect(await readLocalFieldDefs("tripLog")).toEqual([water]);
  });

  it("keep the two entities apart", async () => {
    await saveFieldDefs("tripLog", "guest", [water]);
    await saveFieldDefs("canyon", "guest", [party]);
    expect(await readLocalFieldDefs("tripLog")).toEqual([water]);
    expect(await readLocalFieldDefs("canyon")).toEqual([party]);
  });
});

describe("deleting a guest's field", () => {
  it("counts and strips the trips that carry a value", async () => {
    trips = [
      { id: "t1", customFields: { water: "high", party: 4 } },
      { id: "t2", customFields: { party: 2 } },
      { id: "t3", customFields: { water: "low" } },
    ];
    await saveFieldDefs("tripLog", "guest", [water, party]);

    expect(await countFieldValues("tripLog", "guest", "water")).toBe(2);
    const cleared = await removeFieldDef("tripLog", "guest", "water", [water, party]);

    expect(cleared).toBe(2);
    // Through the outbox, so the clearing reaches the server if they ever link.
    expect(tripUpdates).toEqual([
      { id: "t1", fields: { customFields: { party: 4 } } },
      { id: "t3", fields: { customFields: {} } },
    ]);
    expect(await readLocalFieldDefs("tripLog")).toEqual([party]);
  });

  it("keeps the rest of a canyon's attributes when it strips one value", async () => {
    canyons = [
      {
        id: "c1",
        syncRole: "owner",
        attributes: { sources: [["Wiki", "https://example.test"]], customFields: { permit: "yes" } },
      },
      // A canyon shared WITH this user is not theirs to edit.
      { id: "c2", syncRole: "shared", attributes: { customFields: { permit: "no" } } },
    ];
    const permit: TripLogCustomFieldDef = { key: "permit", label: "Permit", type: "boolean" };
    await saveFieldDefs("canyon", "guest", [permit]);

    expect(await countFieldValues("canyon", "guest", "permit")).toBe(1);
    expect(await removeFieldDef("canyon", "guest", "permit", [permit])).toBe(1);
    expect(canyonUpdates).toEqual([
      {
        id: "c1",
        fields: {
          attributes: {
            sources: [["Wiki", "https://example.test"]],
            customFields: {},
          },
        },
      },
    ]);
  });
});

describe("mergeFieldDefs", () => {
  // The account may already have values behind its keys on the web, and a phone
  // that has never seen them cannot be the authority on their label or type.
  it("lets the account win a key collision and appends the rest", () => {
    const renamed: TripLogCustomFieldDef = { key: "water", label: "Flow", type: "string" };
    expect(mergeFieldDefs([renamed], [water, party])).toEqual([renamed, party]);
  });
});

describe("adoptLocalFieldDefs", () => {
  it("pushes the phone's fields to the account and clears the local copy", async () => {
    await saveFieldDefs("tripLog", "guest", [water]);
    await adoptLocalFieldDefs({
      uiPreferences: { tripLogCustomFields: [party] },
    } as never);

    expect(patched).toEqual([{ entity: "tripLog", defs: [party, water] }]);
    expect(await readLocalFieldDefs("tripLog")).toEqual([]);
  });

  it("does nothing for an install that never made a field", async () => {
    await adoptLocalFieldDefs({ uiPreferences: {} } as never);
    expect(patched).toEqual([]);
  });

  // A link made in a tunnel must retry, not silently drop the list.
  it("keeps the local copy when the PATCH fails", async () => {
    await saveFieldDefs("canyon", "guest", [party]);
    const queries = await import("../api/queries");
    vi.spyOn(queries, "updateCustomFieldDefs").mockRejectedValueOnce(
      new Error("offline"),
    );

    await expect(adoptLocalFieldDefs({ uiPreferences: {} } as never)).rejects.toThrow();
    expect(await readLocalFieldDefs("canyon")).toEqual([party]);
  });
});

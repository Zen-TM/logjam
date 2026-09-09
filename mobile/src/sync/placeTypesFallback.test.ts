import { describe, expect, it, vi } from "vitest";
import { SYSTEM_PLACE_TYPE_IDS } from "@logjam/shared";

// A guest never syncs, and an account before its first pull has an empty
// mirror — in both cases the type picker would have nothing in it, and
// creating a place would be impossible for exactly the user with no way to fix
// it. The system types are compiled in, so they are the answer there.

let rows: Record<string, unknown>[] = [];

vi.mock("./syncDb", () => ({
  getSyncDb: () =>
    Promise.resolve({
      getAllAsync: () => Promise.resolve(rows),
    }),
  notifyMirrorChanged: () => {},
}));

const { listMirrorPlaceTypes } = await import("./mirrorStore");

describe("listMirrorPlaceTypes", () => {
  it("falls back to the compiled-in system types on an empty mirror", async () => {
    rows = [];
    const types = await listMirrorPlaceTypes();
    expect(types.map((type) => type.name)).toEqual([
      "Canyon",
      "Campsite",
      "Marker",
    ]);
    expect(types[0].id).toBe(SYSTEM_PLACE_TYPE_IDS.canyon);
    // A system type belongs to no account, and a client must not read the
    // fallback as "mine" any more than it reads a pulled system row that way.
    expect(types.every((type) => type.ownerId === null)).toBe(true);
  });

  it("uses the mirror once it holds anything at all", async () => {
    rows = [
      {
        id: "type-1",
        owner_id: "user-1",
        name: "Cave",
        icon_key: "circle",
        color: "#123456",
        position: 3,
        created_at: null,
        updated_at: null,
      },
    ];
    const types = await listMirrorPlaceTypes();
    expect(types).toEqual([
      {
        id: "type-1",
        ownerId: "user-1",
        name: "Cave",
        iconKey: "circle",
        color: "#123456",
        position: 3,
        createdAt: "",
        updatedAt: "",
      },
    ]);
  });
});

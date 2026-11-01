import { describe, expect, it } from "vitest";

import { addableFromMirror } from "./addable";

const place = (id: string, syncRole = "owner") =>
  ({ id, name: id, syncRole }) as never;
const route = (
  id: string,
  ownerId: string | null,
  placeId: string | null = null,
) => ({ id, name: id, ownerId, placeId }) as never;
const file = (
  id: string,
  linkedId: string | null = null,
  syncState = "synced",
) =>
  ({
    id,
    linkedType: linkedId ? "place" : "none",
    linkedId,
    syncState,
  }) as never;
const state = {
  me: "me",
  pendingCreates: new Set(["pending"]),
  tickedPlaceIds: [],
  copyMedia: true,
};
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe("what Add a copy offers from the mirror", () => {
  // Mutation: drop the pending-create filter, and a pin dropped offline is
  // offered, 404s, and stops the run with every pick after it unsent.
  it("leaves out places not on the server yet, and shared ones", () => {
    const offered = addableFromMirror(
      {
        places: [place("mine"), place("pending"), place("bobs", "shared")],
        routes: [],
        files: [],
      },
      state,
    );
    expect(ids(offered.places)).toEqual(["mine"]);
  });

  // Mutation: map a null owner to `me`, and an unsynced route is offered.
  it("offers only the caller's own routes on the server", () => {
    const offered = addableFromMirror(
      {
        places: [],
        routes: [route("r1", "me"), route("r2", null), route("r3", "bob")],
        files: [],
      },
      state,
    );
    expect(ids(offered.routes)).toEqual(["r1"]);
  });

  // Mutation: drop either file filter, and a file still uploading, or a
  // shared place's way (the sharer's), is offered and refused.
  it("offers uploaded files of the caller's own, not a shared place's way", () => {
    const offered = addableFromMirror(
      {
        places: [place("mine"), place("bobs", "shared")],
        routes: [],
        files: [
          file("loose"),
          file("ofMine", "mine"),
          file("ofBobs", "bobs"),
          file("uploading", null, "pendingUpload"),
        ],
      },
      state,
    );
    expect(ids(offered.files)).toEqual(["loose", "ofMine"]);
  });
});

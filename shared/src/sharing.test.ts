import { describe, expect, it } from "vitest";

import {
  BULK_SHARE_ITEM_TYPES,
  copyAndRemoveConfirm,
  isCopyableSharedRow,
  removeShareConfirm,
  sharedRowVisibility,
} from "./sharing";

// The rule these pin is the reason the helper exists: a row that is visible
// BOTH ways must not offer a Remove, because revoking the direct share leaves
// the place arm standing and the row comes back on the next pull.
describe("sharedRowVisibility", () => {
  it("calls an owned row owned, whatever it is linked to", () => {
    expect(sharedRowVisibility({ syncRole: "owner", visibleLinkedPlaceIds: ["c1"] })).toBe(
      "owned",
    );
  });

  it("treats an unknown role as owned — a Remove is never offered on a guess", () => {
    expect(sharedRowVisibility({ syncRole: null })).toBe("owned");
    expect(sharedRowVisibility({ syncRole: undefined })).toBe("owned");
  });

  it("calls a shared row with no visible place link a direct share", () => {
    expect(sharedRowVisibility({ syncRole: "shared" })).toBe("direct");
    expect(sharedRowVisibility({ syncRole: "shared", visibleLinkedPlaceIds: [] })).toBe(
      "direct",
    );
  });

  it("calls a shared row linked to a place the caller can see inherited", () => {
    expect(
      sharedRowVisibility({ syncRole: "shared", visibleLinkedPlaceIds: ["c1"] }),
    ).toBe("via-place");
  });
});

describe("removeShareConfirm", () => {
  it("names the owner and never promises a delete", () => {
    const { title, body } = removeShareConfirm({
      kindLabel: "place",
      itemName: "Claustral",
      ownerName: "alice",
    });
    expect(title).toBe("Remove shared place?");
    expect(body).toContain("Claustral");
    expect(body).toContain("alice keeps the original");
    // The two words this copy must never contain: it is not destructive and it
    // is not irreversible.
    expect(body).not.toMatch(/permanent|can't be undone|cannot be undone/i);
  });

  it("falls back to an unnamed owner", () => {
    expect(
      removeShareConfirm({ kindLabel: "waypoint", itemName: "Carpark" }).body,
    ).toContain("The owner keeps the original");
  });
});

// The predicate that decides which shared rows get a "Save a copy" verb. The
// split it pins is not arbitrary: rows copy into the account, map artefacts are
// downloaded to the device and already outlive the share there.
describe("isCopyableSharedRow", () => {
  it("copies the two ROW kinds into the account", () => {
    expect(isCopyableSharedRow({ entityType: "place" })).toBe(true);
    expect(isCopyableSharedRow({ entityType: "route" })).toBe(true);
  });

  it("leaves the two MAP ARTEFACT kinds to the device download", () => {
    expect(isCopyableSharedRow({ entityType: "topoJob" })).toBe(false);
    expect(isCopyableSharedRow({ entityType: "geoPdfJob" })).toBe(false);
  });

  // Every sharable kind has to be answered for, so a fifth one cannot join the
  // union and quietly inherit "not copyable" without someone deciding.
  it("answers for every kind a bulk share can name", () => {
    for (const entityType of BULK_SHARE_ITEM_TYPES) {
      expect(typeof isCopyableSharedRow({ entityType })).toBe("boolean");
    }
  });
});

describe("copyAndRemoveConfirm", () => {
  it("promises the copy survives, and that the original is untouched", () => {
    const { title, body } = copyAndRemoveConfirm({
      kindLabel: "place",
      itemName: "Claustral",
      ownerName: "alice",
    });
    expect(title).toBe("Save a copy and remove?");
    expect(body).toContain("Claustral");
    expect(body).toContain("alice keeps the original");
    // Nothing is destroyed at the owner's end, so the copy must not say so.
    expect(body).not.toMatch(/permanent|cannot be undone/i);
  });

  // THE POINT OF THIS CONFIRM. After the remove there is no second chance to
  // notice the photos did not come — on the phone the cached blobs go in the
  // same tap — so the count has to be in the sentence before it.
  it("names the media the copy leaves behind", () => {
    expect(
      copyAndRemoveConfirm({
        kindLabel: "place",
        itemName: "Claustral",
        mediaLeftBehind: 4,
      }).body,
    ).toContain("4 photos and files are NOT copied");
    expect(
      copyAndRemoveConfirm({
        kindLabel: "place",
        itemName: "Claustral",
        mediaLeftBehind: 1,
      }).body,
    ).toContain("1 photo or file is NOT copied");
  });

  it("says nothing about media when none is left behind", () => {
    for (const mediaLeftBehind of [0, undefined]) {
      expect(
        copyAndRemoveConfirm({
          kindLabel: "route",
          itemName: "Exit track",
          ...(mediaLeftBehind === undefined ? {} : { mediaLeftBehind }),
        }).body,
      ).not.toMatch(/NOT copied/);
    }
  });

  // FOUND ON THE EMULATOR, not by a test: the unnamed fallback appears in two
  // positions and one of them starts a sentence, so a single lower-case form
  // rendered "…on every device. the owner keeps the original."
  it("capitalises the unnamed owner where it starts a sentence, and not where it does not", () => {
    const body = copyAndRemoveConfirm({ kindLabel: "route", itemName: "Exit track" }).body;
    expect(body).toContain("The owner keeps the original");
    expect(body).toContain("whether or not the owner keeps sharing");
    expect(body).not.toMatch(/\. the owner/);
  });

  it("uses a real username as given, in both positions", () => {
    const body = copyAndRemoveConfirm({
      kindLabel: "place",
      itemName: "Claustral",
      ownerName: "bob",
    }).body;
    expect(body).toContain("whether or not bob keeps sharing");
    expect(body).toContain("bob keeps the original");
  });
});

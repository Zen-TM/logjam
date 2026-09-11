import { describe, expect, it } from "vitest";

import { removeShareConfirm, sharedRowVisibility } from "./sharing";

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

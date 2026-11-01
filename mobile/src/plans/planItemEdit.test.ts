import { describe, expect, it } from "vitest";

import type { TripPlanItem } from "@logjam/shared";

import { itemPatch, itemWords } from "./planItemEdit";

const place = {
  kind: "place",
  id: "p1",
  name: "Camp",
  notes: null,
} as unknown as TripPlanItem;
const file = {
  kind: "media",
  id: "m1",
  item: { displayName: null },
} as unknown as TripPlanItem;

describe("itemPatch", () => {
  it("is null when nothing changed", () => {
    expect(itemPatch(place, itemWords(place))).toBeNull();
  });

  it("sends each changed field as the stored value and the new one", () => {
    expect(itemPatch(place, { name: " Base ", notes: "Water here" })).toEqual({
      name: { from: "Camp", to: "Base" },
      notes: { from: null, to: "Water here" },
    });
  });

  it("clears a file's name with null, from its stored null", () => {
    expect(itemPatch(file, { name: "Photo", notes: "" })).toEqual({
      displayName: { from: null, to: "Photo" },
    });
  });
});

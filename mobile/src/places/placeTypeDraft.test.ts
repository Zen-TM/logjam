import { describe, expect, it } from "vitest";

import { placeTypeFormKey } from "./placeTypeDraft";

const cave = { id: "type-cave" };

describe("the place type form's draft", () => {
  // Add "Cave", then open "New type" again: the form still held Cave's name,
  // icon and colour. The form is a hook that is never unmounted, and both
  // opens were the one key "new".
  // Mutation: a key that ignores `open`.
  it("starts over each time the form is opened", () => {
    expect(placeTypeFormKey(false, null)).not.toBe(
      placeTypeFormKey(true, null),
    );
    expect(placeTypeFormKey(false, null)).not.toBe(
      placeTypeFormKey(true, cave),
    );
  });

  it("keeps a draft while the form stays open on the same thing", () => {
    expect(placeTypeFormKey(true, null)).toBe(placeTypeFormKey(true, null));
    expect(placeTypeFormKey(true, cave)).toBe(placeTypeFormKey(true, cave));
    expect(placeTypeFormKey(true, cave)).not.toBe(
      placeTypeFormKey(true, { id: "type-hut" }),
    );
    expect(placeTypeFormKey(true, cave)).not.toBe(placeTypeFormKey(true, null));
  });
});

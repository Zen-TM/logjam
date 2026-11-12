import { describe, expect, it } from "vitest";

import { placeTypeFormKey } from "./placeTypeDraft";

const cave = { id: "type-cave" };

describe("the place type form's draft", () => {
  // Opening "New type" after editing a type must not retain the previous
  // type's name, icon and colour: the form is a hook that is never unmounted.
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

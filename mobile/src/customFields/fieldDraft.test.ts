import { describe, expect, it } from "vitest";
import type { ScopedCustomFieldDef } from "@logjam/shared";

import { fieldFormKey, seedDraft } from "./fieldDraft";

const depth: ScopedCustomFieldDef = {
  key: "depth",
  label: "Depth",
  type: "integer",
  ownerId: "user-1",
  placeTypeIds: ["type-cave"],
  tripTypes: [],
  appliesToAllTypes: false,
};

describe("the attribute form's draft", () => {
  // Add a type, switch the place being added to it, add an attribute: the
  // attribute went on Canyon, the type the form had when it first rendered.
  // Mutation: one constant key for every new attribute.
  it("starts over when a new attribute is opened from a different place type", () => {
    expect(fieldFormKey(null, "type-canyon")).not.toBe(
      fieldFormKey(null, "type-cave"),
    );
    expect(seedDraft("place", null, "type-cave").typeIds).toEqual([
      "type-cave",
    ]);
  });

  it("keeps a draft while the same thing is being edited", () => {
    expect(fieldFormKey(null, "type-cave")).toBe(
      fieldFormKey(null, "type-cave"),
    );
    expect(fieldFormKey(depth, "type-cave")).toBe(
      fieldFormKey(depth, "type-canyon"),
    );
    expect(fieldFormKey(depth, undefined)).not.toBe(
      fieldFormKey(null, undefined),
    );
  });

  it("opens from Settings on every type, and an edit on its own scope", () => {
    expect(seedDraft("place", null, undefined)).toMatchObject({
      appliesToAll: true,
      typeIds: [],
    });
    expect(seedDraft("place", depth, "type-canyon")).toMatchObject({
      label: "Depth",
      appliesToAll: false,
      typeIds: ["type-cave"],
    });
  });
});

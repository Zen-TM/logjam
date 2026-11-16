import { describe, expect, it } from "vitest";

import { placeVerbEntries, unavailableItem } from "./placeVerbMenu";

const off = { state: "Not available here", reason: "Made-up reason." };
const items = (unavailable = {}) =>
  placeVerbEntries("row", true, () => {}, false, unavailable).flatMap(
    (entry) => ("separator" in entry ? [] : [entry]),
  );

describe("placeVerbEntries' unavailable verbs", () => {
  // Mutation: apply `unavailable` to every verb, or to none, and a verb the
  // region can run is dimmed, or Sharpen an area here runs where it cannot.
  it("marks the named verb and leaves the others as they were", () => {
    const marked = items({ makeTopo: off });
    expect(marked.length).toBeGreaterThanOrEqual(5);
    expect(marked.find((i) => i.id === "makeTopo")).toMatchObject({
      disabledReason: "Not available here",
      accessibleLabel:
        "Sharpen an area here, Not available here. Made-up reason.",
    });
    expect(
      marked.filter((i) => i.id !== "makeTopo").map((i) => i.disabledReason),
    ).toEqual(marked.slice(1).map(() => undefined));
  });

  // Mutation: set `disabledReason` on the verb when `unavailable` is empty.
  it("adds nothing where every verb can run", () => {
    expect(items().map((i) => i.disabledReason)).toEqual(
      items().map(() => undefined),
    );
  });
});

describe("unavailableItem", () => {
  // Mutation: name the item by its reason alone, and a screen reader loses
  // the label the item shows (axe's label-content-name-mismatch).
  it("names the item by its label first", () => {
    expect(unavailableItem("Sharpen an area", off).accessibleLabel).toBe(
      "Sharpen an area, Not available here. Made-up reason.",
    );
  });
});

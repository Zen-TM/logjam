import { describe, expect, it } from "vitest";

import { VISIBLE_PLACES, linkablePlaces, truncationHint } from "./linkablePlaces";

const place = (name: string, syncRole?: string) => ({ id: name, name, syncRole });
const many = (count: number) =>
  Array.from({ length: count }, (_, i) => place(`Place ${String(i).padStart(3, "0")}`));

describe("linkablePlaces", () => {
  it("drops places shared with the user — the API refuses those links", () => {
    const { visible } = linkablePlaces(
      [place("Mine"), place("Theirs", "shared")],
      "",
    );
    expect(visible.map((c) => c.name)).toEqual(["Mine"]);
  });

  it("filters case-insensitively on the query", () => {
    const { visible } = linkablePlaces([place("Claustral"), place("Ranon")], "clau");
    expect(visible.map((c) => c.name)).toEqual(["Claustral"]);
  });

  it("reports nothing hidden while under the cap", () => {
    expect(linkablePlaces(many(VISIBLE_PLACES), "").hiddenCount).toBe(0);
  });

  // The bug: the list stopped at the cap and said nothing.
  it("caps the list and counts what it left out", () => {
    const result = linkablePlaces(many(VISIBLE_PLACES + 7), "");
    expect(result.visible).toHaveLength(VISIBLE_PLACES);
    expect(result.hiddenCount).toBe(7);
  });

  it("counts hidden matches AFTER the filter, not before", () => {
    const owned = [...many(VISIBLE_PLACES + 20), place("Claustral")];
    expect(linkablePlaces(owned, "claustral").hiddenCount).toBe(0);
  });
});

describe("truncationHint", () => {
  it("says nothing when nothing was cut", () => {
    expect(truncationHint(12, 0)).toBeNull();
  });

  it("reports the shown and the true total", () => {
    expect(truncationHint(40, 7)).toBe(
      "Showing 40 of 47 — keep typing to narrow it down.",
    );
  });
});

import { describe, expect, it } from "vitest";

import { VISIBLE_CANYONS, linkableCanyons, truncationHint } from "./linkableCanyons";

const canyon = (name: string, syncRole?: string) => ({ id: name, name, syncRole });
const many = (count: number) =>
  Array.from({ length: count }, (_, i) => canyon(`Canyon ${String(i).padStart(3, "0")}`));

describe("linkableCanyons", () => {
  it("drops canyons shared with the user — the API refuses those links", () => {
    const { visible } = linkableCanyons(
      [canyon("Mine"), canyon("Theirs", "shared")],
      "",
    );
    expect(visible.map((c) => c.name)).toEqual(["Mine"]);
  });

  it("filters case-insensitively on the query", () => {
    const { visible } = linkableCanyons([canyon("Claustral"), canyon("Ranon")], "clau");
    expect(visible.map((c) => c.name)).toEqual(["Claustral"]);
  });

  it("reports nothing hidden while under the cap", () => {
    expect(linkableCanyons(many(VISIBLE_CANYONS), "").hiddenCount).toBe(0);
  });

  // The bug: the list stopped at the cap and said nothing.
  it("caps the list and counts what it left out", () => {
    const result = linkableCanyons(many(VISIBLE_CANYONS + 7), "");
    expect(result.visible).toHaveLength(VISIBLE_CANYONS);
    expect(result.hiddenCount).toBe(7);
  });

  it("counts hidden matches AFTER the filter, not before", () => {
    const owned = [...many(VISIBLE_CANYONS + 20), canyon("Claustral")];
    expect(linkableCanyons(owned, "claustral").hiddenCount).toBe(0);
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

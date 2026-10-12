import { describe, expect, it } from "vitest";
import { SAVED_CATEGORIES } from "./savedKeys";
import { showsGeoPdfRunCard } from "./geoPdfRunCard";

describe("showsGeoPdfRunCard", () => {
  it("shows on the GeoPDF tab only", () => {
    const shown = [...SAVED_CATEGORIES, "all" as const].filter(
      showsGeoPdfRunCard,
    );
    expect(shown).toEqual(["geoPdf"]);
  });
});

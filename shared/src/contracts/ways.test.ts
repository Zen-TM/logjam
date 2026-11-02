import { describe, expect, it } from "vitest";
import { WAY_KINDS, WAY_KIND_WORDS } from "./ways.js";

describe("WAY_KINDS", () => {
  // Mutation: add a kind to WAY_KINDS without words for it (tsc also refuses).
  it("has words for every kind", () => {
    expect(Object.keys(WAY_KIND_WORDS).sort()).toEqual([...WAY_KINDS].sort());
  });

  // Where a way lives is a property of the row, not a kind.
  it("names only what a way IS", () => {
    expect([...WAY_KINDS]).toEqual(["route", "track", "import"]);
  });
});

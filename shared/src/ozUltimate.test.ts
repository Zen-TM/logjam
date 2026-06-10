import { describe, it, expect } from "vitest";
import { matchOzUltimateUrl } from "./ozUltimate.js";

describe("matchOzUltimateUrl", () => {
  it("matches an exact name (after suffix-stripping/normalisation)", () => {
    expect(matchOzUltimateUrl("Claustral Canyon")).toBe(
      "https://ozultimate.com/canyoning/track_notes/claustral.htm",
    );
  });

  it("matches via a gazetteer entry's altNames", () => {
    expect(matchOzUltimateUrl("Starlight")).toBe(
      "https://ozultimate.com/canyoning/track_notes/newnes.htm",
    );
  });

  it("matches via the canyonAltNames param against a gazetteer altName", () => {
    // "Foo Canyon" matches nothing in the gazetteer by its primary name, but
    // its alt name "Wheengee Whungee" matches Whungee Wheengee Canyon's
    // altNames entry.
    expect(matchOzUltimateUrl("Foo Canyon", ["Wheengee Whungee"])).toBe(
      "https://ozultimate.com/canyoning/track_notes/whungee_wheengee.htm",
    );
  });

  it("returns null for an ambiguous query matching multiple entries", () => {
    // "Bowens Creek" substring-matches all three Bowens Creek entries
    // (Lower Bowens Creek North, Bowens Creek North, Upper Bowens Creek South)
    // after suffix-stripping.
    expect(matchOzUltimateUrl("Bowens Creek")).toBeNull();
  });

  it("returns null for a name with no match", () => {
    expect(matchOzUltimateUrl("Nonexistent Canyon Name")).toBeNull();
  });
});

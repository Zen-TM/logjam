import { describe, expect, it } from "vitest";
import { MAP_INK } from "./designTokens.js";
import { PIN_CASING_COLOR, PIN_HALO_COLOR, pinHaloRadius } from "./mapPin.js";

describe("a place pin's outline", () => {
  // Mutation: drop the casing width from `pinHaloRadius`, and the white halo
  // hides under the casing instead of ringing it.
  it("puts the halo outside the casing", () => {
    expect(pinHaloRadius(6)).toBe(8.5);
  });

  // Mutation: set the casing to `MAP_INK.ring`, and a pin vanishes on light land.
  it("casts a dark casing and a white halo", () => {
    expect(PIN_CASING_COLOR).toBe(MAP_INK.casing);
    expect(PIN_HALO_COLOR).toBe(MAP_INK.ring);
  });
});

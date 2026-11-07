import { describe, expect, it } from "vitest";

import { stepAtX, xAtStep } from "./scrubberMath";

describe("the scrubber's arithmetic", () => {
  // Mutation: drop the clamp, and a finger dragged past either end asks for
  // a step the run does not have.
  it("holds a finger off the track to the first and last step", () => {
    expect(stepAtX(-40, 200, 3, 20)).toBe(3);
    expect(stepAtX(900, 200, 3, 20)).toBe(20);
  });

  it("rounds to the nearest step, from the first", () => {
    expect(stepAtX(100, 200, 0, 10)).toBe(5);
    expect(stepAtX(0, 200, 4, 14)).toBe(4);
    expect(stepAtX(19, 200, 0, 10)).toBe(1);
  });

  // Mutation: divide by `last` instead of `last - first`, and the thumb
  // drifts off the finger when the first step is not 0.
  it("puts the thumb where the finger would choose that step", () => {
    for (const step of [4, 9, 14])
      expect(stepAtX(xAtStep(step, 200, 4, 14), 200, 4, 14)).toBe(step);
  });

  it("copes with one step and no width", () => {
    expect(stepAtX(50, 200, 7, 7)).toBe(7);
    expect(xAtStep(7, 200, 7, 7)).toBe(0);
    expect(stepAtX(10, 0, 2, 9)).toBe(2);
  });
});

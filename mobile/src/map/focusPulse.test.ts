import { describe, expect, it } from "vitest";

import {
  FOCUS_PULSE_COUNT,
  FOCUS_PULSE_MS,
  focusPulseOpacity,
} from "./focusPulse";

describe("focusPulseOpacity", () => {
  it("starts and ends invisible", () => {
    expect(focusPulseOpacity(0)).toBe(0);
    expect(focusPulseOpacity(FOCUS_PULSE_MS)).toBe(0);
    expect(focusPulseOpacity(FOCUS_PULSE_MS + 500)).toBe(0);
  });

  it("peaks once per pulse", () => {
    for (let pulse = 0; pulse < FOCUS_PULSE_COUNT; pulse += 1) {
      const peak = ((pulse + 0.5) / FOCUS_PULSE_COUNT) * FOCUS_PULSE_MS;
      expect(focusPulseOpacity(peak)).toBeCloseTo(1, 5);
    }
  });

  it("returns to zero between pulses, so they read as separate", () => {
    for (let pulse = 1; pulse < FOCUS_PULSE_COUNT; pulse += 1) {
      const trough = (pulse / FOCUS_PULSE_COUNT) * FOCUS_PULSE_MS;
      expect(focusPulseOpacity(trough)).toBeCloseTo(0, 5);
    }
  });
});

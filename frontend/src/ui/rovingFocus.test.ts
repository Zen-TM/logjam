import { describe, expect, it } from "vitest";
import { nextEnabledIndex } from "./rovingFocus";

describe("nextEnabledIndex", () => {
  const disabled = [false, true, false, false];

  it("moves forward and back, skipping disabled entries", () => {
    expect(nextEnabledIndex(disabled, 0, "ArrowRight")).toBe(2);
    expect(nextEnabledIndex(disabled, 2, "ArrowLeft")).toBe(0);
    expect(nextEnabledIndex(disabled, 0, "ArrowDown")).toBe(2);
  });

  it("wraps at both ends", () => {
    expect(nextEnabledIndex(disabled, 3, "ArrowRight")).toBe(0);
    expect(nextEnabledIndex(disabled, 0, "ArrowUp")).toBe(3);
  });

  it("jumps to the first and last enabled entries", () => {
    expect(nextEnabledIndex([true, false, false, true], 2, "Home")).toBe(1);
    expect(nextEnabledIndex([true, false, false, true], 1, "End")).toBe(2);
  });

  it("starts from nothing focused", () => {
    expect(nextEnabledIndex(disabled, -1, "ArrowDown")).toBe(0);
  });

  it("ignores other keys and a fully disabled set", () => {
    expect(nextEnabledIndex(disabled, 0, "Enter")).toBeNull();
    expect(nextEnabledIndex([true, true], 0, "ArrowRight")).toBeNull();
  });
});

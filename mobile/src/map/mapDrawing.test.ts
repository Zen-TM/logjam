import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SHOW_AFTER_MS,
  isMapDrawing,
  markMapDrawing,
  markMapDrawn,
} from "./mapDrawing";

// Mutation that turns this red: setting the flag in markMapDrawing at once
// (the layers glyph then flickers on every partly drawn frame).
describe("mapDrawing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    markMapDrawn();
    vi.useRealTimers();
  });

  it("stays off for a pan that finishes quickly", () => {
    markMapDrawing();
    vi.advanceTimersByTime(SHOW_AFTER_MS - 1);
    markMapDrawn();
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    expect(isMapDrawing()).toBe(false);
  });

  it("does not restart its wait on every partly drawn frame", () => {
    markMapDrawing();
    vi.advanceTimersByTime(SHOW_AFTER_MS - 100);
    markMapDrawing();
    vi.advanceTimersByTime(100);
    expect(isMapDrawing()).toBe(true);
  });

  it("goes off the moment the map is drawn", () => {
    markMapDrawing();
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    expect(isMapDrawing()).toBe(true);
    markMapDrawn();
    expect(isMapDrawing()).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { railNudge } from "./railNudge";

describe("railNudge", () => {
  const viewport = { x: 0, width: 300 };

  // Mutation: drop the `width <= 0` guard, and a rail asked before its layout
  // runs (the first mount) reports "already in view" and never scrolls to a
  // selected chip off the end.
  it("waits for the chip and the rail's width", () => {
    expect(railNudge(undefined, viewport, 48)).toBeUndefined();
    expect(railNudge({ x: 500, width: 80 }, { x: 0, width: 0 }, 48)).toBe(
      undefined,
    );
  });

  // Mutation: compare against the viewport's edge, not the fade's, and a chip
  // under the end fade counts as in view.
  it("scrolls a chip off the end into view, clear of the fade", () => {
    expect(railNudge({ x: 500, width: 80 }, viewport, 48)).toBe(
      500 + 80 - 300 + 48,
    );
    expect(railNudge({ x: 240, width: 80 }, viewport, 48)).toBe(
      240 + 80 - 300 + 48,
    );
  });

  it("scrolls back to a chip before the start, and leaves one in view", () => {
    expect(railNudge({ x: 20, width: 80 }, { x: 200, width: 300 }, 48)).toBe(0);
    expect(railNudge({ x: 100, width: 80 }, viewport, 48)).toBeNull();
  });
});

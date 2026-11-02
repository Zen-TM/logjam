import { describe, expect, it } from "vitest";

import { samePoints } from "./samePoints";

describe("samePoints", () => {
  // Mutation: compare only the lengths.
  it("is true for the same line and false once a point moves or goes", () => {
    const line = [
      [150.1, -33.2],
      [150.2, -33.3],
    ];
    expect(
      samePoints(
        line,
        line.map((p) => [...p]),
      ),
    ).toBe(true);
    expect(
      samePoints(line, [
        [150.1, -33.2],
        [150.2, -33.31],
      ]),
    ).toBe(false);
    expect(samePoints(line, line.slice(0, 1))).toBe(false);
  });
});

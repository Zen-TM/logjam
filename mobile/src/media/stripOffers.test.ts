import { describe, expect, it } from "vitest";
import { stripOffers } from "./stripOffers";

describe("stripOffers", () => {
  // Mutation: drop the `readOnly` check in stripOffers and a sharee is offered
  // Add again.
  it("offers a read-only strip neither Add nor delete", () => {
    expect(
      stripOffers({ readOnly: true, atLimit: false, hasAddWay: false }),
    ).toEqual({ add: false, remove: false });
    expect(
      stripOffers({ readOnly: true, atLimit: true, hasAddWay: true }),
    ).toEqual({ add: false, remove: false });
  });

  it("offers an owner's strip Add until the limit, Replace past it", () => {
    expect(stripOffers({ atLimit: false, hasAddWay: false }).add).toBe(true);
    expect(stripOffers({ atLimit: true, hasAddWay: false }).add).toBe(false);
    expect(stripOffers({ atLimit: true, hasAddWay: true }).add).toBe(true);
    expect(stripOffers({ atLimit: true, hasAddWay: false }).remove).toBe(true);
  });
});

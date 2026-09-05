import { describe, expect, it } from "vitest";

import { withoutPlaceId, withoutPlaceLink } from "./placeLinks";

const DEAD = "11111111-1111-4111-8111-111111111111";
const ALIVE = "22222222-2222-4222-8222-222222222222";

describe("withoutPlaceId", () => {
  it("drops the dead id and keeps the rest, in order", () => {
    expect(withoutPlaceId(JSON.stringify([ALIVE, DEAD]), DEAD)).toBe(
      JSON.stringify([ALIVE]),
    );
  });

  it("empties a single-link waypoint rather than leaving a ghost", () => {
    expect(withoutPlaceId(JSON.stringify([DEAD]), DEAD)).toBe("[]");
  });

  it("says 'nothing to do' when the id isn't there", () => {
    // The call sites prefilter with LIKE '%id%', which matches substrings and
    // unrelated rows; null is what keeps the UPDATE off them.
    expect(withoutPlaceId(JSON.stringify([ALIVE]), DEAD)).toBeNull();
    expect(withoutPlaceId("[]", DEAD)).toBeNull();
    expect(withoutPlaceId(null, DEAD)).toBeNull();
  });

  it("leaves a column it cannot parse alone", () => {
    expect(withoutPlaceId("not json", DEAD)).toBeNull();
    expect(withoutPlaceId('{"id":"x"}', DEAD)).toBeNull();
  });
});

describe("withoutPlaceLink", () => {
  it("drops the link by id, keeping the names of the others", () => {
    const links = [
      { id: ALIVE, name: "Claustral" },
      { id: DEAD, name: "Ranon" },
    ];
    expect(withoutPlaceLink(JSON.stringify(links), DEAD)).toBe(
      JSON.stringify([{ id: ALIVE, name: "Claustral" }]),
    );
  });

  it("is a no-op when the trip never linked that place", () => {
    const links = [{ id: ALIVE, name: "Claustral" }];
    expect(withoutPlaceLink(JSON.stringify(links), DEAD)).toBeNull();
  });
});

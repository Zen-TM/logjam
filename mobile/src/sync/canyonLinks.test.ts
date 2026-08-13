import { describe, expect, it } from "vitest";

import { withoutCanyonId, withoutCanyonLink } from "./canyonLinks";

const DEAD = "11111111-1111-4111-8111-111111111111";
const ALIVE = "22222222-2222-4222-8222-222222222222";

describe("withoutCanyonId", () => {
  it("drops the dead id and keeps the rest, in order", () => {
    expect(withoutCanyonId(JSON.stringify([ALIVE, DEAD]), DEAD)).toBe(
      JSON.stringify([ALIVE]),
    );
  });

  it("empties a single-link waypoint rather than leaving a ghost", () => {
    expect(withoutCanyonId(JSON.stringify([DEAD]), DEAD)).toBe("[]");
  });

  it("says 'nothing to do' when the id isn't there", () => {
    // The call sites prefilter with LIKE '%id%', which matches substrings and
    // unrelated rows; null is what keeps the UPDATE off them.
    expect(withoutCanyonId(JSON.stringify([ALIVE]), DEAD)).toBeNull();
    expect(withoutCanyonId("[]", DEAD)).toBeNull();
    expect(withoutCanyonId(null, DEAD)).toBeNull();
  });

  it("leaves a column it cannot parse alone", () => {
    expect(withoutCanyonId("not json", DEAD)).toBeNull();
    expect(withoutCanyonId('{"id":"x"}', DEAD)).toBeNull();
  });
});

describe("withoutCanyonLink", () => {
  it("drops the link by id, keeping the names of the others", () => {
    const links = [
      { id: ALIVE, name: "Claustral" },
      { id: DEAD, name: "Ranon" },
    ];
    expect(withoutCanyonLink(JSON.stringify(links), DEAD)).toBe(
      JSON.stringify([{ id: ALIVE, name: "Claustral" }]),
    );
  });

  it("is a no-op when the trip never linked that canyon", () => {
    const links = [{ id: ALIVE, name: "Claustral" }];
    expect(withoutCanyonLink(JSON.stringify(links), DEAD)).toBeNull();
  });
});

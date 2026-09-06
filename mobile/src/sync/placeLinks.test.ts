import { describe, expect, it } from "vitest";

import { withoutPlaceLink } from "./placeLinks";

const DEAD = "11111111-1111-4111-8111-111111111111";
const ALIVE = "22222222-2222-4222-8222-222222222222";

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

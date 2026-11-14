import { NSW_REGION, type Region } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { homeView } from "./mapChrome";

describe("homeView", () => {
  // Mutation: return NSW's view whatever region the account has.
  it("opens an account in another region on that region's view", () => {
    const north: Region = {
      ...NSW_REGION,
      id: "north",
      view: { center: [-110.8, 38.27], zoom: 11 },
    };
    expect(homeView(["north"], [NSW_REGION, north])).toEqual({
      center: [-110.8, 38.27],
      zoom: 11,
    });
  });

  // Mutation: return a fixed centre, not the account region's view.
  it("opens an NSW account where it always has: on NSW's view", () => {
    expect(homeView(["nsw"])).toEqual({
      center: [...NSW_REGION.view.center],
      zoom: NSW_REGION.view.zoom,
    });
  });

  // Mutation: return null for ids that name no region.
  it("opens an account with no known region on the default region's view", () => {
    expect(homeView(["atlantis"])).toEqual(homeView(["nsw"]));
  });
});

import { NSW_REGION } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { homeView } from "./mapChrome";

describe("homeView", () => {
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

import { describe, expect, it, vi } from "vitest";
import type { Gauge } from "@logjam/shared";

import { gaugeSearchItems } from "./gaugeSearch";

vi.mock("../saved/bboxOfPoints", () => ({
  bboxOfPoints: (points: unknown) => points,
}));

const GAUGE: Gauge = {
  id: "900001",
  name: "MADE UP R @ ONE",
  lat: -33.5,
  lon: 150.5,
  hot: false,
  hasFlow: true,
  readings: [],
};

describe("gaugeSearchItems", () => {
  // Mutation: use the raw name, or drop `gaugeId`, which is what opens the
  // gauge's sheet.
  it("offers a gauge by its readable name, with its id and position", async () => {
    const [item] = gaugeSearchItems([GAUGE]);
    expect(item).toMatchObject({
      title: "Made Up River at One",
      kindLabel: "River gauge",
      gaugeId: "900001",
    });
    expect(await item?.resolveBbox()).toEqual([{ lon: 150.5, lat: -33.5 }]);
  });
});

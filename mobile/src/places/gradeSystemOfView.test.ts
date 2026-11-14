import { NSW_REGION, type Region } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { gradeSystemOfView } from "./gradeSystemOfView";

// A made-up region around a made-up point, graded in ACA: the one a test
// can use without the simulated regions, which only a dev build declares.
const UTAH: [number, number] = [-110.8, 38.27];
const ACA_REGION: Region = {
  ...NSW_REGION,
  id: "acaland",
  view: { center: UTAH, zoom: 11 },
  borders: [
    [
      [-110.9, 38.2],
      [-110.7, 38.2],
      [-110.7, 38.35],
      [-110.9, 38.35],
    ],
  ],
  canyonGrades: "aca",
};
const REGIONS: Region[] = [NSW_REGION, ACA_REGION];
const BLUE_MOUNTAINS: [number, number] = [150.31, -33.7];

describe("the grade system of the view", () => {
  // Mutation: read the account's opening view and ignore the camera.
  it("is that of the region under the camera", () => {
    expect(gradeSystemOfView(UTAH, ["nsw"], REGIONS)).toBe("aca");
    expect(gradeSystemOfView(BLUE_MOUNTAINS, ["acaland"], REGIONS)).toBe(
      "french",
    );
  });

  // Mutation: return "french" when there is no camera yet.
  it("is that of the account's opening view before the map has settled", () => {
    expect(gradeSystemOfView(null, ["acaland"], REGIONS)).toBe("aca");
    expect(gradeSystemOfView(null, ["nsw"], REGIONS)).toBe("french");
  });
});

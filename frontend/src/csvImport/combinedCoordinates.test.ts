import { describe, expect, it } from "vitest";
import { splitCombinedCoordinates } from "./combinedCoordinates";

describe("splitCombinedCoordinates", () => {
  it("leaves a logbook with a '2, 4' column alone", () => {
    const headers = ["Name", "Date", "Score"];
    const rows = [{ Name: "Claustral", Date: "2024-01-02", Score: "2, 4" }];
    expect(splitCombinedCoordinates(headers, rows).headers).toBe(headers);
  });
  it("rejects out-of-range pairs and decimal commas", () => {
    for (const cell of ["-33,5603", "150.4, -33.5", "95, 10"]) {
      const out = splitCombinedCoordinates(
        ["Name", "Where"],
        [{ Name: "x", Where: cell }],
      );
      expect(out.headers).toEqual(["Name", "Where"]);
    }
  });
});

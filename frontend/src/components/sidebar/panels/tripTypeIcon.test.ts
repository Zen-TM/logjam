import { describe, expect, it } from "vitest";
import { tripTypeOptions } from "./tripTypeIcon";

const values = (vocabulary: string[], selected: string[]) =>
  tripTypeOptions(vocabulary, selected).map((option) => option.value);

describe("a trip-type picker's chips", () => {
  // Mutation: drop the `selected.find(…) ??`, and a picked "CANYONING" gets a
  // second chip beside "canyoning", which the API refuses as one type twice.
  it("shows each type once, in the casing the selection uses", () => {
    expect(
      values(["canyoning", "Canyoning", "walk"], ["CANYONING", "packraft"]),
    ).toEqual(["CANYONING", "walk", "packraft"]);
  });

  // Mutation: drop the append loop, and a pick the vocabulary lacks loses
  // its chip, so it can't be unpicked.
  it("keeps the first casing of a vocabulary twin, and every extra pick", () => {
    expect(values(["a", "A"], [])).toEqual(["a"]);
    expect(values([], ["packraft"])).toEqual(["packraft"]);
  });
});

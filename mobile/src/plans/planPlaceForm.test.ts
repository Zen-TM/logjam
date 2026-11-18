import { describe, expect, it, vi } from "vitest";
import {
  itemFieldDefs,
  newPlaceWords,
  SYSTEM_PLACE_TYPE_IDS,
} from "@logjam/shared";
import { addNewPlaceToPlan, placeFormProblem } from "./planPlaceForm";

const api = vi.hoisted(() => ({
  addPlanItem: vi.fn(),
  afterPlanWrite: vi.fn(),
}));
vi.mock("./plansApi", () => ({ addPlanItem: api.addPlanItem }));
vi.mock("./plansCache", () => ({ afterPlanWrite: api.afterPlanWrite }));

const marker = SYSTEM_PLACE_TYPE_IDS.marker;
const at = { latitude: -33.5, longitude: 150.4 };

describe("placeFormProblem", () => {
  // Mutation: stop requiring coordinates, and a blank position is sent.
  it("is null for a picked point and names a missing one", () => {
    const defs = itemFieldDefs({ placeTypeId: marker });
    expect(placeFormProblem(newPlaceWords(marker, at), defs)).toBeNull();
    expect(placeFormProblem(newPlaceWords(marker), defs)).toMatch(/Latitude/);
  });

  // Mutation: drop the elevation check, and "abc" reaches the API as NaN.
  it("refuses an elevation that is not a number", () => {
    const defs = itemFieldDefs({ placeTypeId: marker });
    const words = { ...newPlaceWords(marker, at), elevation: "abc" };
    expect(placeFormProblem(words, defs)).not.toBeNull();
  });
});

describe("addNewPlaceToPlan", () => {
  // Mutation: send `{ kind: "place", id }` (a copy), and the place is looked
  // for in the maker's account instead of being made in the plan.
  it("makes the place in the plan from the form's words", async () => {
    api.addPlanItem.mockResolvedValue(undefined);
    const words = { ...newPlaceWords(marker, at), name: " Water drop " };
    await addNewPlaceToPlan("p", marker, words);
    expect(api.addPlanItem).toHaveBeenCalledWith("p", {
      kind: "place",
      new: expect.objectContaining({
        placeTypeId: marker,
        name: "Water drop",
        latitude: at.latitude,
        longitude: at.longitude,
      }),
    });
    expect(api.afterPlanWrite).toHaveBeenCalledWith("p");
  });

  // Mutation: swallow the refusal, and the sheet closes on a place never made.
  it("throws a refusal without refreshing the plan", async () => {
    api.afterPlanWrite.mockClear();
    api.addPlanItem.mockRejectedValue(new Error("offline"));
    await expect(
      addNewPlaceToPlan("p", marker, newPlaceWords(marker, at)),
    ).rejects.toThrow("offline");
    expect(api.afterPlanWrite).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from "vitest";

// The module builds a Prisma client and reads S3 env at import; the cap under
// test is pure, so both are stubbed out.
vi.mock("../services/prisma", () => ({ default: {} }));

import { truncateDisplayName } from "./bulkDelete";
import { TRIP_NAME_MAX_LENGTH, formatTripCanyonNames } from "@logjam/shared";

// STP-005: deleting canyons backfills a derived title onto trips that lose
// their last linked canyon. User-typed titles are capped at
// TRIP_NAME_MAX_LENGTH (parseDisplayName); the derived one was not, so a
// many-canyon trip got a label PATCH /trips/:id would refuse to save.
describe("truncateDisplayName", () => {
  it("passes through a title within the cap", () => {
    expect(truncateDisplayName("Claustral & Ranon")).toBe("Claustral & Ranon");
    expect(truncateDisplayName(null)).toBeNull();
  });

  it("caps a long derived join at the same limit user input gets", () => {
    const derived = formatTripCanyonNames(
      Array.from({ length: 20 }, (_, i) => `Very Long Canyon Name Number ${i}`),
    );
    expect(derived!.length).toBeGreaterThan(TRIP_NAME_MAX_LENGTH);
    expect(truncateDisplayName(derived)!.length).toBe(TRIP_NAME_MAX_LENGTH);
  });
});

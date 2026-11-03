import { ApiError } from "@logjam/shared";
import { describe, expect, it } from "vitest";
import { isNotInAccount } from "./notOnServer";

describe("isNotInAccount", () => {
  // Mutation: widen it to any ApiError and a 500 tells the user to sync.
  it("is true only for a 404", () => {
    expect(isNotInAccount(new ApiError(404, "/shares/place/x", "POST"))).toBe(
      true,
    );
    expect(isNotInAccount(new ApiError(500, "/shares/place/x", "POST"))).toBe(
      false,
    );
    expect(isNotInAccount(new Error("offline"))).toBe(false);
  });
});

import { ApiError } from "@logjam/shared";
import { describe, expect, it } from "vitest";
import { shareGrantNotFound } from "./notOnServer";

const notFound = new ApiError(404, "/shares/place/x", "POST");

describe("shareGrantNotFound", () => {
  // Mutation: widen it to any ApiError and a 500 tells the user to sync.
  it("is only for a 404", () => {
    expect(
      shareGrantNotFound(new ApiError(500, "/shares/place/x", "POST"), true),
    ).toBeNull();
    expect(shareGrantNotFound(new Error("offline"), true)).toBeNull();
  });

  // Mutation: ignore `stillHeld` and a place deleted elsewhere says to sync.
  it("reuses the needs-upload wording while the phone still holds the row", () => {
    expect(shareGrantNotFound(notFound, true)).toEqual({
      message: "Needs to sync first.",
      syncFixes: true,
    });
  });

  it("says it was deleted once the mirror has dropped the row", () => {
    expect(shareGrantNotFound(notFound, false)).toEqual({
      message: "This was deleted.",
      syncFixes: false,
    });
  });
});

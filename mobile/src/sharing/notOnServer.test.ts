import { ApiError } from "@logjam/shared";
import { describe, expect, it } from "vitest";
import { unavailableReasonText } from "../auth/capabilities";
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

  // Mutation: ignore `stillHeld` and a place deleted elsewhere says to sync;
  // or reword either `Needs to sync first` (here or in capabilities.ts) and the
  // two copies differ.
  it("says the needs-upload reason, with a full stop, while the phone still holds the row", () => {
    const grant = shareGrantNotFound(notFound, true);
    expect(grant?.syncFixes).toBe(true);
    expect(grant?.message).toBe(unavailableReasonText("needs-upload") + ".");
  });

  it("says it was deleted once the mirror has dropped the row", () => {
    expect(shareGrantNotFound(notFound, false)).toEqual({
      message: "This was deleted.",
      syncFixes: false,
    });
  });
});

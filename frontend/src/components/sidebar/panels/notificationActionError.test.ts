import { describe, it, expect } from "vitest";
import { isResolvedElsewhereError } from "./notificationActionError";
import { ApiError } from "../../../errors/ApiError";

describe("isResolvedElsewhereError", () => {
  it("treats a 400 (e.g. 'Friend request is not pending') as resolved elsewhere", () => {
    expect(isResolvedElsewhereError(new ApiError(400, "/friends/1/accept", "PATCH"))).toBe(true);
  });

  it("treats a 409 (e.g. duplicate/conflicting request) as resolved elsewhere", () => {
    expect(isResolvedElsewhereError(new ApiError(409, "/friends/1/accept", "PATCH"))).toBe(true);
  });

  it("does not treat a 404 as resolved elsewhere", () => {
    expect(isResolvedElsewhereError(new ApiError(404, "/friends/1/accept", "PATCH"))).toBe(false);
  });

  it("does not treat a 403 as resolved elsewhere", () => {
    expect(isResolvedElsewhereError(new ApiError(403, "/friends/1/accept", "PATCH"))).toBe(false);
  });

  it("does not treat a 5xx as resolved elsewhere", () => {
    expect(isResolvedElsewhereError(new ApiError(500, "/friends/1/accept", "PATCH"))).toBe(false);
  });

  it("does not treat a non-ApiError as resolved elsewhere", () => {
    expect(isResolvedElsewhereError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isResolvedElsewhereError("some string")).toBe(false);
    expect(isResolvedElsewhereError(null)).toBe(false);
  });
});

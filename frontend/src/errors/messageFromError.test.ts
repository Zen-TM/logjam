import { describe, it, expect } from "vitest";
import { messageFromError } from "./messageFromError";
import { ApiError } from "./ApiError";

describe("messageFromError", () => {
  it("prefers a server-supplied message on an ApiError", () => {
    const err = new ApiError(409, "/friends", "POST", "Already friends or request pending.");
    expect(messageFromError(err, "fallback")).toBe("Already friends or request pending.");
  });

  it("maps a known status code when no server message is present", () => {
    expect(messageFromError(new ApiError(403, "/x", "GET"), "fallback")).toBe(
      "You don't have permission to do that.",
    );
    expect(messageFromError(new ApiError(404, "/x", "GET"), "fallback")).toBe(
      "The requested item could not be found.",
    );
  });

  it("uses a generic 5xx message for unmapped server errors", () => {
    expect(messageFromError(new ApiError(502, "/x", "GET"), "fallback")).toBe(
      "Something went wrong on the server. Please try again.",
    );
  });

  it("falls back for an unmapped 4xx with no server message", () => {
    expect(messageFromError(new ApiError(418, "/x", "GET"), "custom fallback")).toBe(
      "custom fallback",
    );
  });

  it("detects a network fetch TypeError", () => {
    const err = new TypeError("Failed to fetch");
    expect(messageFromError(err, "fallback")).toMatch(/Couldn't reach the server/);
  });

  it("detects a 'Network Error' message", () => {
    expect(messageFromError(new Error("Network Error"), "fallback")).toMatch(
      /Couldn't reach the server/,
    );
  });

  it("returns the fallback for an unknown error", () => {
    expect(messageFromError(new Error("weird"), "fallback")).toBe("fallback");
    expect(messageFromError("a string", "fallback")).toBe("fallback");
  });
});

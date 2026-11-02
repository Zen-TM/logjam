import { describe, it, expect } from "vitest";
import { messageFromError, ApiError } from "./apiErrors.js";

describe("messageFromError", () => {
  it("prefers a server-supplied message on an ApiError", () => {
    const err = new ApiError(
      409,
      "/friends",
      "POST",
      "Already friends or request pending.",
    );
    expect(messageFromError(err, "fallback")).toBe(
      "Already friends or request pending.",
    );
  });

  it("maps a status that means the same everywhere when no server message is present", () => {
    expect(messageFromError(new ApiError(401, "/x", "GET"), "fallback")).toBe(
      "You're signed out. Sign in and try again.",
    );
    expect(messageFromError(new ApiError(429, "/x", "GET"), "fallback")).toBe(
      "Too many requests. Wait a moment and try again.",
    );
  });

  // Mutation: put 404 back into STATUS_MESSAGES.
  it("prefers the caller's words over the 403 and 404 status text", () => {
    for (const status of [403, 404]) {
      expect(
        messageFromError(
          new ApiError(status, "/x", "GET"),
          "Couldn't find this place.",
        ),
      ).toBe("Couldn't find this place.");
    }
  });

  it("uses a generic 5xx message for unmapped server errors", () => {
    expect(messageFromError(new ApiError(502, "/x", "GET"), "fallback")).toBe(
      "Something went wrong on our end. Try again.",
    );
  });

  it("falls back for an unmapped 4xx with no server message", () => {
    expect(
      messageFromError(new ApiError(418, "/x", "GET"), "custom fallback"),
    ).toBe("custom fallback");
  });

  it("detects a network fetch TypeError (browser)", () => {
    const err = new TypeError("Failed to fetch");
    expect(messageFromError(err, "fallback")).toMatch(/Couldn't reach Logjam/);
  });

  it("detects a network fetch TypeError (React Native)", () => {
    const err = new TypeError("Network request failed");
    expect(messageFromError(err, "fallback")).toMatch(/Couldn't reach Logjam/);
  });

  it("detects a 'Network Error' message", () => {
    expect(messageFromError(new Error("Network Error"), "fallback")).toMatch(
      /Couldn't reach Logjam/,
    );
  });

  it("returns the fallback for an unknown error", () => {
    expect(messageFromError(new Error("weird"), "fallback")).toBe("fallback");
    expect(messageFromError("a string", "fallback")).toBe("fallback");
  });
});

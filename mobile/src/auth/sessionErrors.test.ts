import { describe, it, expect } from "vitest";
import { classifySessionError } from "./sessionErrors";

function namedError(name: string, message = "boom"): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe("classifySessionError", () => {
  it("rejects on invalid_grant (expired/revoked refresh token)", () => {
    expect(classifySessionError(namedError("invalid_grant"))).toBe("rejected");
  });

  it("honours an error `code` property when present", () => {
    const err = new Error("x") as Error & { code: string };
    err.code = "invalid_grant";
    expect(classifySessionError(err)).toBe("rejected");
  });

  it("does not reject on other OAuth errors, which say nothing about the session", () => {
    for (const name of ["invalid_client", "server_error", "invalid_request"]) {
      expect(classifySessionError(namedError(name))).toBe("transient");
    }
  });

  it("treats network failures as transient", () => {
    expect(classifySessionError(new TypeError("Network request failed"))).toBe(
      "transient",
    );
    expect(classifySessionError(namedError("NetworkError"))).toBe("transient");
  });

  it("treats unknown errors as transient (fail-open keeps the session)", () => {
    expect(classifySessionError(new Error("weird"))).toBe("transient");
    expect(classifySessionError("a string")).toBe("transient");
    expect(classifySessionError(undefined)).toBe("transient");
  });
});

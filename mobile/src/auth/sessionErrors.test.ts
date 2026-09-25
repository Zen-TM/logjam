import { describe, it, expect } from "vitest";
import { classifySessionError } from "./sessionErrors";

function namedError(name: string, message = "boom"): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe("classifySessionError", () => {
  it("rejects on NotAuthorizedException (expired/revoked refresh token)", () => {
    expect(classifySessionError(namedError("NotAuthorizedException"))).toBe("rejected");
  });

  it("rejects on UserNotFoundException / PasswordResetRequiredException", () => {
    expect(classifySessionError(namedError("UserNotFoundException"))).toBe("rejected");
    expect(classifySessionError(namedError("PasswordResetRequiredException"))).toBe("rejected");
  });

  it("honours an error `code` property when present", () => {
    const err = new Error("x") as Error & { code: string };
    err.code = "NotAuthorizedException";
    expect(classifySessionError(err)).toBe("rejected");
  });

  it("treats network failures as transient", () => {
    expect(classifySessionError(new TypeError("Network request failed"))).toBe("transient");
    expect(classifySessionError(namedError("NetworkError"))).toBe("transient");
  });

  it("treats unknown errors as transient (fail-open keeps the session)", () => {
    expect(classifySessionError(new Error("weird"))).toBe("transient");
    expect(classifySessionError("a string")).toBe("transient");
    expect(classifySessionError(undefined)).toBe("transient");
  });
});

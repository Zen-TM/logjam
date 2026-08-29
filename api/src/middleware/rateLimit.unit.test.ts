import { describe, it, expect } from "vitest";
import { globalLimitMax } from "./rateLimit";

// The override exists so CI's integration run (one shared per-IP bucket, ~250
// tests) isn't throttled. The property that matters is that it is inert in
// production — same fail-closed shape as the AUTH_MODE=fake guard.
describe("globalLimitMax", () => {
  it("defaults to 300 with no override", () => {
    expect(globalLimitMax({})).toBe(300);
    expect(globalLimitMax({ NODE_ENV: "development" })).toBe(300);
  });

  it("honours RATE_LIMIT_GLOBAL_MAX outside production", () => {
    expect(
      globalLimitMax({ NODE_ENV: "development", RATE_LIMIT_GLOBAL_MAX: "100000" }),
    ).toBe(100000);
  });

  it("IGNORES the override in production", () => {
    expect(
      globalLimitMax({ NODE_ENV: "production", RATE_LIMIT_GLOBAL_MAX: "100000" }),
    ).toBe(300);
  });

  it("ignores junk / non-positive / non-integer values", () => {
    for (const RATE_LIMIT_GLOBAL_MAX of ["", "abc", "0", "-5", "1.5", "Infinity"]) {
      expect(globalLimitMax({ RATE_LIMIT_GLOBAL_MAX })).toBe(300);
    }
  });
});

import { describe, expect, it } from "vitest";
import { inTimeZone } from "./timeZone.testHelper.js";

describe("inTimeZone", () => {
  // Mutation: restore with `process.env.TZ = previous` alone, which writes the text "undefined" (read as UTC) when the zone was unset.
  it("leaves a zone that was unset unset, and a set one as it was", () => {
    const before = process.env.TZ;
    try {
      delete process.env.TZ;
      expect(inTimeZone("Australia/Sydney", () => process.env.TZ)).toBe(
        "Australia/Sydney",
      );
      expect("TZ" in process.env).toBe(false);
      process.env.TZ = "America/Los_Angeles";
      inTimeZone("Australia/Sydney", () => undefined);
      expect(process.env.TZ).toBe("America/Los_Angeles");
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});

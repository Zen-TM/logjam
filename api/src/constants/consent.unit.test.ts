import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_CONSENT_VERSION } from "./consent";

// The two pages are what a user consents to; a bump that forgets one gates
// users on text that did not change, or the reverse. Mutation: bump the
// constant without the pages and this turns red.
describe("consent version", () => {
  it.each(["privacy.html", "tos.html"])(
    "%s is dated with the current consent version",
    (page) => {
      const html = readFileSync(
        join(__dirname, "../../../frontend/public", page),
        "utf8",
      );
      expect(html).toContain(`Last updated: ${CURRENT_CONSENT_VERSION}`);
    },
  );
});

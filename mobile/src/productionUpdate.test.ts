import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  branchRefusal,
  buildRefusal,
} from "../scripts/check-production-update";

// Rules 2 and 3 of docs/decisions/0023-ota-runtime-is-the-native-fingerprint.md.
describe("production OTA guard", () => {
  it("publishes only from the release branch of the package version", () => {
    expect(branchRefusal("release/mobile-v1.2.0", "1.2.0")).toBeNull();
    expect(branchRefusal("main", "1.2.0")).toMatch(/release\/mobile-v1\.2\.0/);
    // A hotfix keeps the build's version: a bumped package.json is refused.
    expect(branchRefusal("release/mobile-v1.2.0", "1.2.1")).not.toBeNull();
  });

  it("publishes only onto a production build of that version and runtime", () => {
    const build = { appVersion: "1.2.0", runtimeVersion: "abc" };
    expect(buildRefusal([build], "abc", "1.2.0")).toBeNull();
    expect(buildRefusal([], "abc", "1.2.0")).toMatch(/needs a release/);
    expect(buildRefusal([build], "def", "1.2.0")).not.toBeNull();
    expect(buildRefusal([build], "abc", "1.3.0")).not.toBeNull();
  });

  // Mutation: drop the guard from either script and this goes red.
  it("runs before every script that publishes to production", () => {
    const { scripts } = JSON.parse(
      readFileSync(join(__dirname, "../package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const production = Object.entries(scripts).filter(([, cmd]) =>
      /eas update.*production/.test(cmd),
    );
    expect(production.map(([name]) => name).sort()).toEqual([
      "promote:production",
      "update:production",
    ]);
    for (const [name, cmd] of production)
      expect(cmd, name).toMatch(
        /^node scripts\/check-production-update\.js && eas update/,
      );
  });
});

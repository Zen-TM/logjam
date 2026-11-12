import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  branchRefusal,
  buildRefusal,
  checkoutRefusal,
  promotedGroup,
} from "../scripts/check-production-update";

// Rules 2 and 3 of docs/decisions/0023-ota-runtime-is-the-native-fingerprint.md.
describe("production OTA guard", () => {
  // Mutation: make branchRefusal accept any branch, or another version's.
  it("publishes only from the release branch of the package version", () => {
    expect(branchRefusal("release/mobile-v1.2.0", "1.2.0")).toBeNull();
    expect(branchRefusal("main", "1.2.0")).toMatch(/release\/mobile-v1\.2\.0/);
    // A hotfix keeps the build's version: a bumped package.json is refused.
    expect(branchRefusal("release/mobile-v1.2.0", "1.2.1")).not.toBeNull();
  });

  // Mutation: drop either condition in checkoutRefusal, or apply the clean-tree
  // one to a promotion.
  it("publishes only a clean checkout that descends from the release tag", () => {
    const clean = { fromTag: true, status: "" };
    expect(checkoutRefusal(clean, "1.2.0", false)).toBeNull();
    expect(
      checkoutRefusal({ ...clean, fromTag: false }, "1.2.0", false),
    ).toMatch(/mobile-v1\.2\.0/);
    const dirty = { ...clean, status: " M mobile/App.tsx" };
    expect(checkoutRefusal(dirty, "1.2.0", false)).toMatch(/App\.tsx/);
    expect(checkoutRefusal(dirty, "1.2.0", true)).toBeNull();
  });

  // Mutation: drop the runtimeVersion or appVersion comparison in buildRefusal.
  it("publishes only onto a production build of that version and runtime", () => {
    const build = { appVersion: "1.2.0", runtimeVersion: "abc" };
    expect(buildRefusal([build], "abc", "1.2.0")).toBeNull();
    expect(buildRefusal([], "abc", "1.2.0")).toMatch(/reach no phone/);
    expect(buildRefusal([build], "def", "1.2.0")).not.toBeNull();
    expect(buildRefusal([build], "abc", "1.3.0")).not.toBeNull();
  });

  // Mutation: return null for a promotion without --group.
  it("checks the group a promotion republishes, and requires one", () => {
    expect(promotedGroup(["promote", "--group", "g1", "--message", "m"])).toBe(
      "g1",
    );
    expect(promotedGroup(["promote"])).toBeUndefined();
    expect(promotedGroup([])).toBeNull();
  });

  // Mutation: drop the guard from either script, or stop passing a promotion's
  // arguments to it, and this goes red.
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
    expect(scripts["update:production"]).toMatch(
      /^node scripts\/check-production-update\.js && scripts\/check-eas-env\.sh production && eas update /,
    );
    expect(scripts["promote:production"]).toMatch(
      /^sh -c 'node scripts\/check-production-update\.js promote "\$@" && eas update:republish .* "\$@"' sh$/,
    );
  });
});

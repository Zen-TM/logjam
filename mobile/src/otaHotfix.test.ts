import { describe, expect, it } from "vitest";

import { latestRelease, planComment, planRefusal } from "../scripts/ota-hotfix";

// The automated OTA hotfix lane: docs/operations/mobile-release.md, and
// docs/decisions/0046-ota-hotfixes-publish-from-ci-on-a-labelled-merge.md.
describe("OTA hotfix plan", () => {
  // Mutation: compare versions as strings, or let a release candidate through.
  it("targets the newest release tag, never a candidate", () => {
    expect(
      latestRelease([
        "mobile-v0.9.0",
        "mobile-v0.10.0",
        "mobile-v0.10.1-rc.1",
        "maplibre-android-v1.0.0",
      ]),
    ).toBe("0.10.0");
    expect(latestRelease(["mobile-v1.0.0-rc.1", ""])).toBeNull();
  });

  const ok = {
    version: "1.2.0",
    changed: ["mobile/src/a.ts"],
    pick: "ok" as const,
    baseRuntime: "abc",
    patchedRuntime: "abc",
  };

  it("lets a clean JavaScript-only fix through", () => {
    expect(planRefusal(ok)).toBeNull();
    expect(planRefusal({ ...ok, changed: ["shared/src/a.ts"] })).toBeNull();
  });

  // Mutation: drop any one condition in planRefusal.
  it("refuses what an update must not carry", () => {
    expect(planRefusal({ ...ok, version: null })).toMatch(/no build/);
    expect(
      planRefusal({ ...ok, changed: ["mobile/src/a.ts", "api/src/b.ts"] }),
    ).toMatch(/api\/src\/b\.ts/);
    expect(planRefusal({ ...ok, changed: ["frontend/src/a.ts"] })).toMatch(
      /nothing under mobile/,
    );
    expect(planRefusal({ ...ok, pick: "empty" })).toMatch(/already has/);
    expect(planRefusal({ ...ok, pick: ["mobile/src/a.ts"] })).toMatch(
      /mobile\/src\/a\.ts conflict/,
    );
    expect(planRefusal({ ...ok, patchedRuntime: "def" })).toMatch(
      /needs a release/,
    );
  });

  // Mutation: post the go-ahead when the plan or the smoke failed.
  it("promises a publish only when every check passed", () => {
    const plan = {
      version: "1.2.0",
      runtime: "abc",
      refusal: "",
      plan: "success",
      smoke: "success",
      runUrl: "https://example.invalid/run",
    };
    expect(planComment(plan)).toMatch(
      /^<!-- ota-plan -->\nOn merge.*1\.2\.0.*abc/,
    );
    expect(planComment({ ...plan, refusal: "No tag." })).toMatch(
      /Can't publish.*No tag\./,
    );
    expect(planComment({ ...plan, plan: "failure" })).toMatch(/Can't publish/);
    expect(planComment({ ...plan, smoke: "cancelled" })).toMatch(/Maestro/);
  });
});

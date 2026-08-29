import { describe, expect, it } from "vitest";

import {
  isVersionBelowMinimum,
  parseSemver,
  storeListingUrl,
  upgradeEnforcement,
} from "./version";

describe("parseSemver", () => {
  it("parses a bare semver", () => {
    expect(parseSemver("1.22.333")).toEqual([1, 22, 333]);
  });

  it.each(["1.2", "v1.2.3", "1.2.3-beta", "mobile/1.2.3", "", "a.b.c"])(
    "throws on %j",
    (bad) => {
      expect(() => parseSemver(bad)).toThrow("Invalid semver");
    }
  );
});

describe("isVersionBelowMinimum", () => {
  it.each([
    ["0.1.0", "0.0.0", false],
    ["0.1.0", "0.1.0", false],
    ["0.1.0", "0.1.1", true],
    ["0.1.0", "0.2.0", true],
    ["0.1.0", "1.0.0", true],
    ["1.0.0", "0.9.9", false],
    // numeric compare, not lexicographic
    ["0.10.0", "0.9.0", false],
    ["0.9.0", "0.10.0", true],
  ])("current %s vs min %s → below=%s", (current, minimum, below) => {
    expect(isVersionBelowMinimum(current, minimum)).toBe(below);
  });
});

describe("upgradeEnforcement", () => {
  it.each([
    // belowMinimum, metered, outcome — every cell of the MAPP-002 table.
    [false, false, "none"],
    [false, true, "none"],
    [false, null, "none"],
    [true, false, "block"],
    [true, true, "warn"],
    // The one that matters: no answer from the platform is NOT an invitation
    // to block someone who may be mid-trip on a hotspot.
    [true, null, "warn"],
  ] as const)("below=%s metered=%s → %s", (belowMinimum, metered, expected) => {
    expect(upgradeEnforcement({ belowMinimum, metered })).toBe(expected);
  });
});

describe("storeListingUrl", () => {
  it("links the Play listing for the id app.json declares", () => {
    expect(
      storeListingUrl({ os: "android", androidPackage: "com.logjamnsw.mobile" }),
    ).toBe("https://play.google.com/store/apps/details?id=com.logjamnsw.mobile");
  });

  it.each([
    // The one that matters (MAPP-001): iOS HAS a bundleIdentifier and no
    // listing, so a package id present there must still yield no link — the
    // block screen's text is all it gets until there is a listing.
    ["ios", "com.logjamnsw.mobile"],
    ["web", "com.logjamnsw.mobile"],
    ["macos", "com.logjamnsw.mobile"],
    // Android with nothing to link to: the app.json read came back empty.
    ["android", ""],
    ["android", null],
    ["android", undefined],
    ["ios", null],
  ] as const)("gives no link on %s with package %j", (os, androidPackage) => {
    expect(storeListingUrl({ os, androidPackage })).toBeNull();
  });

  it("is the https form, so it resolves without the Play app installed", () => {
    const url = storeListingUrl({ os: "android", androidPackage: "a.b" });
    expect(url?.startsWith("https://")).toBe(true);
    expect(url).not.toContain("market://");
  });
});

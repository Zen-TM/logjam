import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ONGOING_TAP_KINDS,
  ONGOING_TAP_SCHEME,
  ongoingTapKind,
} from "./ongoingTap";

const read = (path: string) =>
  readFileSync(join(__dirname, "../..", path), "utf8");

describe("ongoingTapKind", () => {
  it.each(ONGOING_TAP_KINDS)("reads the %s URI", (kind) => {
    expect(ongoingTapKind(`${ONGOING_TAP_SCHEME}${kind}`)).toBe(kind);
  });

  // Mutation: match on the scheme alone, and an unknown host (or the sign-in
  // redirect, `logjam://auth`) is taken for a notification tap.
  it.each([
    null,
    undefined,
    "",
    "logjam://auth",
    "logjam-ongoing://other",
    "content://x",
  ])("ignores %s", (url) => {
    expect(ongoingTapKind(url)).toBeNull();
  });
});

// The URIs are spelt in Kotlin. Mutation: change one side's spelling, and a
// tap on that notification resumes the app where it was left, as before this
// existed, with nothing failing.
describe("the native notifications", () => {
  const spelt = (kind: string) => `"${ONGOING_TAP_SCHEME}${kind}"`;

  it("downloads: DownloadService opens its URI", () => {
    expect(
      read(
        "modules/logjam-download-service/android/src/main/java/expo/modules/logjamdownloadservice/DownloadService.kt",
      ),
    ).toContain(spelt("downloads"));
  });

  it("recording: the expo-location patch, applied and in the patch file, opens its URI", () => {
    expect(
      read(
        "node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt",
      ),
      "patches/expo-location+<version>.patch did not apply",
    ).toContain(spelt("recording"));
    expect(read("patches/expo-location+58.0.20.patch")).toContain(
      spelt("recording"),
    );
  });
});

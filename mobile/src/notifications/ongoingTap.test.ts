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
  // Mutation: add a kind that embeds an identifier (`place-<id>`), and a name
  // or coordinate rides in an intent other apps can read.
  it("has only fixed words as kinds", () => {
    for (const kind of ONGOING_TAP_KINDS) expect(kind).toMatch(/^[a-z]+$/);
  });

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

  // Mutation: drop the ACTION_VIEW line and React Native reports no URI to JS,
  // so the tap resumes the app as before; drop the `data` line and the string
  // constant still matches while nothing is sent.
  it("downloads: DownloadService opens its URI as a VIEW", () => {
    const source = read(
      "modules/logjam-download-service/android/src/main/java/expo/modules/logjamdownloadservice/DownloadService.kt",
    );
    expect(source).toContain(spelt("downloads"));
    expect(source).toMatch(/launch\.action = Intent\.ACTION_VIEW/);
    expect(source).toMatch(/launch\.data = Uri\.parse\(TAP_URI\)/);
  });

  it("recording: the expo-location patch, applied and in the patch file, opens its URI as a VIEW", () => {
    const lines = (source: string) => {
      expect(source).toMatch(/it\.action = Intent\.ACTION_VIEW/);
      expect(source).toContain(
        `it.data = android.net.Uri.parse(${spelt("recording")})`,
      );
    };
    lines(
      read(
        "node_modules/expo-location/android/src/main/java/expo/modules/location/services/LocationTaskService.kt",
      ),
    );
    lines(read("patches/expo-location+58.0.20.patch"));
  });
});

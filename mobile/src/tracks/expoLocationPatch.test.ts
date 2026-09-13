// The recorder's map-focus boost (`setRecordingMapFocusBoost`) depends on a
// native patch to expo-location, and a missing patch fails SILENTLY: the
// unboost is rejected from the background, the recorder stays at 3 s with the
// screen off, and nothing on screen says so. patch-package refuses an install
// whose patch no longer applies, but not one where postinstall never ran — so
// check the installed source itself.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("expo-location patch", () => {
  it("lets an options update to a running task through from the background", () => {
    const source = readFileSync(
      join(
        __dirname,
        "../../node_modules/expo-location/android/src/main/java/expo/modules/location/LocationModule.kt",
      ),
      "utf8",
    );
    expect(source).toContain("!AppForegroundedSingleton.isForegrounded && options.foregroundService != null && !isUpdatingRunningTask");
  });

  // The patch is to KOTLIN SOURCE, and expo-location also ships a precompiled
  // AAR (`local-maven-repo/`) that Gradle links by default. Without this entry
  // the build ignores the patched file completely — which is exactly how the
  // first patched dev client on the Pixel still refused the unboost.
  it("is built from source, not from the precompiled AAR", () => {
    const packageJson = JSON.parse(
      readFileSync(join(__dirname, "../../package.json"), "utf8"),
    ) as { expo?: { autolinking?: { android?: { buildFromSource?: string[] } } } };
    expect(packageJson.expo?.autolinking?.android?.buildFromSource).toContain(
      "expo-location",
    );
  });
});

// The sharpened areas' request transforms (sharpenedArchives.ts) change while
// the map loads tiles, and stock MLRN 11.5 iterates its transform map on
// OkHttp's threads while the UI thread writes it: a write mid-iteration throws
// ConcurrentModificationException on a dispatcher thread, which crashes the
// app. `patches/@maplibre+maplibre-react-native+<version>.patch` makes the map
// copy-on-write. patch-package refuses an install whose patch no longer
// applies, but not one where postinstall never ran, so check the installed
// source itself. MLRN's Android code is built from source, so no
// buildFromSource entry is needed (unlike expo-location's, ADR 0014).
// Remove the patch once MLRN's interceptor iterates a snapshot itself.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("MLRN transform patch", () => {
  // Red if the patch is dropped, or postinstall didn't apply it.
  it("lets a transform change while a request reads the transforms", () => {
    const source = readFileSync(
      join(
        __dirname,
        "../../node_modules/@maplibre/maplibre-react-native/android/src/main/java/org/maplibre/reactnative/modules/TransformRequestInterceptor.kt",
      ),
      "utf8",
    );
    expect(
      source,
      "patches/@maplibre+maplibre-react-native+<version>.patch did not apply: an MLRN upgrade needs the patch re-made for the new version, or dropped if the upgrade fixes the race",
    ).toMatch(
      /@Volatile\s+private var urlTransforms: Map<String, UrlTransformConfig>/,
    );
  });
});

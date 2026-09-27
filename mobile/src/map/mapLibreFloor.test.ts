import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Below 13.3.0 the Vulkan backend loses its device on resume and aborts the
// app (docs/decisions/0030). The pin lives in app.json, which cannot carry a
// comment, so the floor is held here.
describe("MapLibre native SDK floor", () => {
  const appJson = JSON.parse(
    readFileSync(join(__dirname, "../../app.json"), "utf8")
  ) as { expo: { plugins: unknown[] } };
  const plugin = appJson.expo.plugins.find(
    (p): p is [string, { android: { nativeVariant: string; nativeVersion: string } }] =>
      Array.isArray(p) && p[0] === "@maplibre/maplibre-react-native"
  );

  it("runs Vulkan on 13.3.0 or later", () => {
    const [major, minor] = (plugin?.[1].android.nativeVersion ?? "0.0")
      .split(".")
      .map(Number);
    expect(
      plugin?.[1].android.nativeVariant,
      "keep the Vulkan backend: OpenGL renders no labels on emulators; retest labels on an emulator and a phone before changing it (docs/decisions/0030)",
    ).toBe("vulkan");
    expect(
      major > 13 || (major === 13 && minor >= 3),
      "@maplibre/maplibre-react-native android.nativeVersion in app.json must stay at 13.3.0 or later: below it Vulkan loses its device on resume and the app aborts (docs/decisions/0030)",
    ).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import appConfig from "../../app.config";

// Below 13.3.0 the Vulkan backend loses its device on resume and aborts
// Logjam GPS. The pin lives in mobile/app.json and maplibre/patched.json,
// which cannot carry a comment, so the floor is held here, on the resolved
// config both feed.
describe("MapLibre native SDK floor", () => {
  const appJson = JSON.parse(
    readFileSync(join(__dirname, "../../app.json"), "utf8"),
  ) as { expo: Record<string, unknown> };
  const resolved = appConfig({
    config: appJson.expo,
  } as Parameters<typeof appConfig>[0]);
  const plugin = (resolved.plugins ?? []).find(
    (
      p,
    ): p is [
      string,
      { android: { nativeVariant: string; nativeVersion: string } },
    ] => Array.isArray(p) && p[0] === "@maplibre/maplibre-react-native",
  );

  it("runs Vulkan on 13.3.0 or later", () => {
    const [major, minor] = (plugin?.[1].android.nativeVersion ?? "0.0")
      .split(".")
      .map(Number);
    expect(
      plugin?.[1].android.nativeVariant,
      "keep the Vulkan backend: OpenGL renders no labels on emulators; retest labels on an emulator and a phone before changing it",
    ).toBe("vulkan");
    expect(
      major > 13 || (major === 13 && minor >= 3),
      "MapLibre's android.nativeVersion (mobile/maplibre/patched.json while it is patched, else mobile/app.json) must stay at 13.3.0 or later: below it Vulkan loses its device on resume and Logjam GPS aborts",
    ).toBe(true);
  });
});

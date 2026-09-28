import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import appConfig from "../app.config";

// An OTA update reaches only builds with its runtime version. Under the
// fingerprint policy a native change gives a new runtime, so an update whose
// JS needs native code a build lacks never reaches that build; under
// "appVersion" it would, and crash it on launch.
describe("OTA runtime version", () => {
  it("is the native fingerprint", () => {
    const appJson = JSON.parse(
      readFileSync(join(__dirname, "../app.json"), "utf8"),
    ) as { expo: Parameters<typeof appConfig>[0]["config"] };
    const resolved = appConfig({
      config: appJson.expo,
    } as Parameters<typeof appConfig>[0]);
    expect(
      resolved.runtimeVersion,
      "runtimeVersion must stay { policy: 'fingerprint' }: see docs/decisions/0023-ota-runtime-is-the-native-fingerprint.md",
    ).toEqual({ policy: "fingerprint" });
  });
});

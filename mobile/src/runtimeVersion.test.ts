import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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

// EAS gives a build google-services.json as a file-type secret, but the release
// workflow's runner computes the fingerprint without it. If the file changed
// the hash, EAS would reject every build with "Runtime version mismatch".
// Guard for .fingerprintignore: delete its lines and the hash below differs.
describe("native fingerprint", () => {
  const fingerprint = (env: Record<string, string | undefined>): string =>
    execFileSync(
      process.execPath,
      [
        "-e",
        `require("@expo/fingerprint").createProjectHashAsync(process.cwd(), { platforms: ["android"], silent: true }).then((h) => console.log(h.hash ?? h))`,
      ],
      {
        cwd: join(__dirname, ".."),
        env: { ...process.env, GOOGLE_SERVICES_JSON: undefined, ...env },
        encoding: "utf8",
      },
    ).trim();

  it("ignores google-services.json, wherever it lives", () => {
    const dir = mkdtempSync(join(tmpdir(), "fingerprint-"));
    try {
      const easSecret = join(dir, "eas-environment-secrets", "e7047f3e");
      mkdirSync(join(dir, "eas-environment-secrets"));
      writeFileSync(easSecret, '{"project_info":{"project_id":"a"}}');
      const local = join(dir, "google-services.json");
      writeFileSync(local, '{"project_info":{"project_id":"b"}}');

      const without = fingerprint({});
      expect(fingerprint({ GOOGLE_SERVICES_JSON: easSecret })).toBe(without);
      expect(fingerprint({ GOOGLE_SERVICES_JSON: local })).toBe(without);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

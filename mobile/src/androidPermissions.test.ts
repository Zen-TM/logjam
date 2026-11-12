import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// "A new dependency can add Android permissions: block each with
// `tools:node="remove"`" (mobile/AGENTS.md). This half needs no Gradle: it runs
// the config plugins over a template manifest and reads which permissions
// carry the removal. It cannot see a permission a library adds in its own
// manifest, which only the built APK shows: `.github/workflows/mobile-emulator.yml`
// diffs `aapt2 dump permissions` against `android-permissions.expected`.
//
// Mutations that turn it red: change a name in app.json `blockedPermissions`,
// in `BLOCKED_PERMISSIONS` of `plugins/withCameraCapture.js` or in
// `PERMISSION` of `plugins/withSensorLogging.js`; set `microphonePermission`
// to a string for expo-image-picker or `isAccessMediaLocationEnabled` to true
// for expo-media-library in app.json.

const require = createRequire(__filename);
const { compileModsAsync, AndroidConfig } = require("@expo/config-plugins");
const withSensorLogging = require("../plugins/withSensorLogging.js");
const withCameraCapture = require("../plugins/withCameraCapture.js");

const appJson = JSON.parse(
  readFileSync(join(__dirname, "../app.json"), "utf8"),
) as {
  expo: {
    android: { blockedPermissions: string[] };
    plugins: (string | [string, Record<string, unknown>])[];
  };
};

// What a user build must not ask for, each with what asks for it.
const MUST_BE_REMOVED = [
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.VIBRATE",
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.ACTIVITY_RECOGNITION",
];

type Entry = { $: Record<string, string> };

async function manifestPermissions(): Promise<Entry[]> {
  let config = {
    name: "x",
    slug: "x",
    android: {
      package: "a.b",
      blockedPermissions: appJson.expo.android.blockedPermissions,
    },
  } as never;
  config = AndroidConfig.Permissions.withInternalBlockedPermissions(config);
  config = withSensorLogging(config);
  config = withCameraCapture(config);
  const compiled = await compileModsAsync(config, {
    projectRoot: mkdtempSync(join(tmpdir(), "logjam-perm-")),
    platforms: ["android"],
    introspect: true,
    assertMissingModProviders: false,
  });
  return compiled._internal.modResults.android.manifest.manifest[
    "uses-permission"
  ];
}

describe("Android permissions the config blocks", () => {
  const saved = process.env.LOGJAM_SENSOR_LOG;
  beforeEach(() => {
    // A user build: the research logger's permission is not wanted.
    delete process.env.LOGJAM_SENSOR_LOG;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.LOGJAM_SENSOR_LOG;
    else process.env.LOGJAM_SENSOR_LOG = saved;
  });

  it("removes each unwanted permission from the merged manifest", async () => {
    const entries = await manifestPermissions();
    expect(entries.length).toBeGreaterThan(3);
    for (const name of MUST_BE_REMOVED) {
      const mine = entries.filter((e) => e.$["android:name"] === name);
      expect(
        mine.map((e) => e.$["tools:node"]),
        `${name} must be declared once with tools:node="remove". Block it in app.json android.blockedPermissions or in the plugin that owns it (plugins/withCameraCapture.js, plugins/withSensorLogging.js); one wanted on purpose is the maintainer's call: take it out of MUST_BE_REMOVED and add it to mobile/android-permissions.expected.`,
      ).toEqual(["remove"]);
    }
  });

  it("asks the libraries that can ask for the microphone and media location not to", () => {
    const options = (name: string) =>
      appJson.expo.plugins.find(
        (p): p is [string, Record<string, unknown>] =>
          Array.isArray(p) && p[0] === name,
      )?.[1];
    expect(options("expo-image-picker")?.microphonePermission).toBe(false);
    expect(options("expo-media-library")?.isAccessMediaLocationEnabled).toBe(
      false,
    );
  });
});

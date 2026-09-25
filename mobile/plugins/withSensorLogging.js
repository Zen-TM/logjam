// Compile the research sensor logger into DEVELOPER builds only.
//
// A runtime toggle was not enough. Left autolinked, `logjam-sensors` ships in
// every user build: dead Kotlin nobody can reach, and — the part that actually
// matters — `ACTIVITY_RECOGNITION` in the shipped manifest, which Play lists on
// the store page and Android shows in app info. An app whose whole pitch is
// that it does not watch you should not ask for the body-activity permission to
// support a feature its users cannot turn on.
//
// Gated on the BUILD-TIME env var `LOGJAM_SENSOR_LOG=1`. Deliberately not an
// `EXPO_PUBLIC_*` var: those are for values the JS bundle reads, and this one
// decides what gets COMPILED. Set it in the EAS `development` profile and when
// building locally for a data-collection trip; leave it unset everywhere else.
//
// Two halves, because excluding the module alone would leave the permission:
//   1. `useExpoModules(exclude: [...])` keeps the Gradle subproject out of the
//      build entirely, so the Kotlin is not compiled and the module is not
//      registered.
//   2. The manifest permission is ADDED here rather than declared in app.json,
//      so its presence follows the same switch instead of being hand-kept in a
//      second place that can disagree.
//
// The JS side must survive the module's absence: `LogjamSensorsModule.ts` uses
// `requireOptionalNativeModule`, which returns null instead of throwing, and
// `tracks/sensorLog.ts` treats null as "this build cannot log".
//
// NATIVE CHANGE, so switching between the two shapes needs a fresh
// `expo prebuild` + build — an OTA update cannot move it (mobile/CLAUDE.md,
// Builds & distribution).
const { withAndroidManifest, withSettingsGradle } = require("@expo/config-plugins");

const MODULE_NAME = "logjam-sensors";
const PERMISSION = "android.permission.ACTIVITY_RECOGNITION";

/** The one place the answer is decided, so both halves cannot disagree. */
function sensorLoggingEnabled() {
  return process.env.LOGJAM_SENSOR_LOG === "1";
}

/**
 * `exclude` is a PROPERTY on the autolinking settings extension, not an
 * argument to `useExpoModules()` (see `ExpoAutolinkingSettingsExtension.kt` —
 * the older `useExpoModules([exclude: ...])` form in
 * `autolinking_implementation.gradle` is a different, unused code path and
 * fails at settings-evaluation time with "Could not find method").
 */
const USE_EXPO_MODULES = "expoAutolinking.useExpoModules()";
const EXCLUDE_LINE = `expoAutolinking.exclude = ['${MODULE_NAME}']`;
/** Any exclude assignment a previous prebuild left behind, with its newline. */
const EXISTING_EXCLUDE = /^expoAutolinking\.exclude = \[[^\]]*\]\r?\n/m;

const withSensorModuleExclusion = (config) =>
  withSettingsGradle(config, (cfg) => {
    // `android/` is generated but NOT wiped between prebuilds, so this runs
    // against its own previous output: normalise back to the bare call and
    // clear any prior assignment first, so switching developer -> user ->
    // developer actually goes both ways.
    cfg.modResults.contents = cfg.modResults.contents
      .replace(/expoAutolinking\.useExpoModules\([^)]*\)/, USE_EXPO_MODULES)
      .replace(EXISTING_EXCLUDE, "");
    if (!cfg.modResults.contents.includes(USE_EXPO_MODULES)) {
      // Expo changed the call shape and this plugin is now silently doing
      // nothing — which would ship the module to users, i.e. fail OPEN on the
      // privacy-relevant side. Refuse the build instead.
      throw new Error(
        `withSensorLogging: expected \`${USE_EXPO_MODULES}\` in ` +
          "settings.gradle and did not find it. The sensor-logging exclusion " +
          "would silently not apply; fix the plugin before building.",
      );
    }
    if (!sensorLoggingEnabled()) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        USE_EXPO_MODULES,
        `${EXCLUDE_LINE}\n${USE_EXPO_MODULES}`,
      );
    }
    return cfg;
  });

/**
 * ACTIVITY_RECOGNITION does NOT come from us — `expo-sensors` declares it in
 * its own `AndroidManifest.xml` for a Pedometer this app never uses, and
 * manifest merging pulls it into every build. Logjam has therefore been asking
 * for the body-activity permission since expo-sensors was added for the
 * compass, which for an app whose pitch is that it does not watch you is a
 * permission worth not having.
 *
 * So a user build BLOCKS it (`tools:node="remove"`, the same mechanism app.json
 * already uses for SYSTEM_ALERT_WINDOW) and a developer build allows it,
 * because there the step counter genuinely needs it. Not merely "does not
 * declare it" — a library-level declaration has to be actively removed, which
 * is why the earlier add/remove version of this was a no-op that still shipped
 * the permission.
 */
const withSensorPermission = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest["uses-permission"] = (manifest["uses-permission"] ?? []).filter(
      (entry) => entry.$?.["android:name"] !== PERMISSION,
    );
    if (sensorLoggingEnabled()) {
      manifest["uses-permission"].push({ $: { "android:name": PERMISSION } });
    } else {
      // Blocked, not absent: the entry must survive into the merged manifest
      // carrying the removal instruction, or expo-sensors puts it back.
      manifest["uses-permission"].push({
        $: { "android:name": PERMISSION, "tools:node": "remove" },
      });
    }
    return cfg;
  });

module.exports = (config) =>
  withSensorPermission(withSensorModuleExclusion(config));

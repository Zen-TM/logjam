import type { ConfigContext, ExpoConfig } from "expo/config";

import packageJson from "./package.json";

// Static config stays in app.json — Expo passes it in as `config` here, and this
// file only layers on the parts that must come from the environment.
//
// google-services.json (FCM/push) is deliberately NOT committed: the repo is
// public, and the file carries the Firebase project id and Android API key.
// EAS builds get it from a `file`-type env variable, which lands on the build
// machine as a path in GOOGLE_SERVICES_JSON. Locally it comes from mobile/.env
// pointing at the gitignored file.
//
// When the variable is absent the key is omitted entirely rather than pointing
// at a missing path (prebuild fails hard on a googleServicesFile that isn't
// there). Push registration already fails soft in that case — the app is
// unaffected apart from having no notifications.
//
// LOGJAM_APP_VARIANT=dev (at prebuild AND for Metro) makes a second app that
// installs beside the real one: its own application id, launcher name and URL
// scheme, so a phone that holds real data can also run a build pointed at the
// local stack. Unset, the config is exactly app.json plus the version.
// Guard: src/appVariant.test.ts.
const DEV_SUFFIX = ".dev";

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = process.env.LOGJAM_APP_VARIANT;
  // A typo must not quietly build the real application id.
  if (variant && variant !== "dev") {
    throw new Error(`LOGJAM_APP_VARIANT must be "dev" or unset: ${variant}`);
  }
  const dev = variant === "dev";
  // The Firebase file has a client entry for the real id only, and the Gradle
  // plugin fails the build on any other: the dev variant goes without push.
  const googleServicesFile = dev ? undefined : process.env.GOOGLE_SERVICES_JSON;
  const base: ExpoConfig = {
    ...config,
    // `config` is typed loosely by ConfigContext; app.json always supplies these.
    name: config.name ?? "Logjam",
    slug: config.slug ?? "logjam-mobile",
    // The one declaration of the app version (guard: src/versionAgreement.test.ts).
    version: packageJson.version,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
  if (!dev) return base;
  return {
    ...base,
    name: `${base.name} Dev`,
    scheme: `${String(base.scheme)}dev`,
    ios: {
      ...base.ios,
      bundleIdentifier: `${base.ios?.bundleIdentifier}${DEV_SUFFIX}`,
    },
    android: {
      ...base.android,
      package: `${base.android?.package}${DEV_SUFFIX}`,
    },
    // expo-dev-client also registers `exp+<slug>`, which the real app's dev
    // client claims too: a link to it would open either app.
    plugins: base.plugins?.map((plugin) =>
      plugin === "expo-dev-client"
        ? ["expo-dev-client", { addGeneratedScheme: false }]
        : plugin,
    ),
  };
};

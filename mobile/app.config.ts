import type { ConfigContext, ExpoConfig } from "expo/config";

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
export default ({ config }: ConfigContext): ExpoConfig => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  return {
    ...config,
    // `config` is typed loosely by ConfigContext; app.json always supplies these.
    name: config.name ?? "Logjam",
    slug: config.slug ?? "logjam-mobile",
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};

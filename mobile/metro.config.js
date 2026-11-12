// Metro config for the monorepo. Resolves the symlinked `@logjam/shared`
// (file:../shared) by watching the monorepo root and both node_modules trees.
// Shared-rebuild rule still applies: `cd shared && npm run build` before Metro
// picks up changes, since imports resolve to shared/dist.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "..");

// Stamps a Debug ID into every bundle and its sourcemap: how Sentry matches an
// OTA update's crash to the map ota-hotfix.yml uploaded, with no release name
// (ADR 0004). Otherwise Expo's default config. The source-context option stays
// off: it adds an unauthenticated /__sentry/context route to the dev server,
// which returns lines of any file under the project (.env, keys/) to anyone
// who can reach Metro. Guard: src/sentryUpload.test.ts.
const config = getSentryExpoConfig(projectRoot, {
  enableSourceContextInDevelopment: false,
});

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
// NOTE: do not set disableHierarchicalLookup — npm nests some transitive deps
// (e.g. node_modules/expo/node_modules/expo-asset) and shared/'s own deps live
// in shared/node_modules; both need hierarchical resolution.

module.exports = config;

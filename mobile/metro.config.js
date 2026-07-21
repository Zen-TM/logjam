// Metro config for the monorepo. Resolves the symlinked `@logjam/shared`
// (file:../shared) by watching the monorepo root and both node_modules trees.
// Shared-rebuild rule still applies: `cd shared && npm run build` before Metro
// picks up changes, since imports resolve to shared/dist.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
// Prevent Metro from walking up past projectRoot for hoisted deps unexpectedly.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;

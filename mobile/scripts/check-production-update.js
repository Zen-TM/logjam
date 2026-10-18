#!/usr/bin/env node
// Runs before every production OTA publish (`update:production`,
// `promote:production`): rules 2 and 3 of docs/decisions/0023-ota-runtime-is-the-native-fingerprint.md.
// Guard: src/productionUpdate.test.ts.
const { execFileSync, spawnSync } = require("node:child_process");

function branchRefusal(branch, version) {
  if (branch === `release/mobile-v${version}`) return null;
  return `A production update is published only from release/mobile-v${version}, cut from the tag of the build it fixes; this checkout is on ${branch}.`;
}

// A branch of the right name can be created locally from any commit, and
// `eas update` bundles the working tree as it is, uncommitted edits included.
// A promotion bundles nothing, so its tree may be dirty.
function checkoutRefusal({ fromTag, status }, version, promoting) {
  if (!fromTag)
    return `This checkout does not descend from tag mobile-v${version} (run git fetch --tags if the tag exists).`;
  if (!promoting && status)
    return `The working tree has changes eas update would bundle:\n${status}`;
  return null;
}

// `promote:production` passes its own arguments as `promote ...`. The group it
// republishes may come from another checkout, so the runtime checked is the group's.
// Without `--group`, `eas update:republish` asks which group, past this check.
function promotedGroup(args) {
  if (args[0] !== "promote") return null;
  const at = args.indexOf("--group");
  return at === -1 ? undefined : args[at + 1];
}

// An update whose runtime no production build has reaches no phone, silently.
function buildRefusal(builds, runtimeVersion, version) {
  if (
    builds.some(
      (b) => b.runtimeVersion === runtimeVersion && b.appVersion === version,
    )
  )
    return null;
  return `No finished production build of ${version} has runtime ${runtimeVersion}, so the update would reach no phone: docs/operations/mobile-release.md, OTA hotfixes, step 4.`;
}

if (require.main === module) {
  const run = (cmd, args) =>
    execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
  const refuse = (reason) => {
    console.error(`Refusing to publish: ${reason}`);
    process.exit(1);
  };

  const { version } = require("../package.json");
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const byBranch = branchRefusal(branch, version);
  if (byBranch) refuse(byBranch);

  const group = promotedGroup(process.argv.slice(2));
  if (group === undefined)
    refuse("promote:production needs --group <update group id>.");

  const fromTag =
    spawnSync("git", [
      "merge-base",
      "--is-ancestor",
      `mobile-v${version}`,
      "HEAD",
    ]).status === 0;
  const status = run("git", ["status", "--porcelain"]).trimEnd();
  const byCheckout = checkoutRefusal(
    { fromTag, status },
    version,
    group !== null,
  );
  if (byCheckout) refuse(byCheckout);
  const runtimeVersion = group
    ? JSON.parse(run("eas", ["update:view", group, "--json"])).find(
        (u) => u.platform === "android",
      )?.runtimeVersion
    : JSON.parse(
        run("npx", [
          "expo-updates",
          "runtimeversion:resolve",
          "--platform",
          "android",
        ]),
      ).runtimeVersion;
  if (!runtimeVersion) refuse(`Update group ${group} has no Android update.`);
  const builds = JSON.parse(
    run("eas", [
      "build:list",
      "--platform",
      "android",
      "--channel",
      "production",
      "--status",
      "finished",
      "--runtime-version",
      runtimeVersion,
      "--json",
      "--non-interactive",
    ]),
  );
  const byBuild = buildRefusal(builds, runtimeVersion, version);
  if (byBuild) refuse(byBuild);
}

module.exports = {
  branchRefusal,
  buildRefusal,
  checkoutRefusal,
  promotedGroup,
};

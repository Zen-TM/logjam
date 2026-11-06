#!/usr/bin/env node
// The automated OTA hotfix lane (docs/operations/mobile-release.md, OTA
// hotfixes): which build a fix would update, and whether it may.
// ota-plan.yml runs it on a labelled PR, ota-hotfix.yml again on the merge.
// Guard: src/otaHotfix.test.ts.
//
//   node scripts/ota-hotfix.js plan <dir> <commit>
//     Checks out release/mobile-vX.Y.Z (or the tag, when the branch doesn't
//     exist yet) into a worktree at <dir>, as a local branch of that name,
//     cherry-picks <commit> onto it and resolves the runtime version before
//     and after. Prints version=, base=, runtime= and refusal= lines for
//     $GITHUB_OUTPUT; refusal= is empty when the hotfix may go ahead.
//
//   node scripts/ota-hotfix.js comment
//     Prints the PR comment for a plan, from VERSION, RUNTIME, REFUSAL, PLAN,
//     SMOKE (job results) and RUN_URL in the environment.
const { execFileSync, spawnSync } = require("node:child_process");
const { join } = require("node:path");

// A release candidate (-rc.N) is not a build in the field, so never a target.
function latestRelease(tags) {
  const versions = tags
    .map((t) => /^mobile-v(\d+)\.(\d+)\.(\d+)$/.exec(t))
    .filter(Boolean)
    .map((m) => m.slice(1).map(Number));
  if (versions.length === 0) return null;
  versions.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return versions.at(-1).join(".");
}

// `pick` is the cherry-pick's outcome: "ok", "empty" or the conflicted paths.
function planRefusal({ version, changed, pick, baseRuntime, patchedRuntime }) {
  if (!version)
    return "No mobile-vX.Y.Z tag exists, so there is no build to hotfix.";
  // The API deploys on the same merge, so the two would race.
  const api = changed.filter((f) => f.startsWith("api/"));
  if (api.length > 0)
    return `It also changes api/ (${api.join(", ")}), which deploys on the same merge: land the API change first, in its own PR.`;
  if (!changed.some((f) => /^(mobile|shared)\//.test(f)))
    return "It changes nothing under mobile/ or shared/, so an update would carry nothing.";
  if (pick === "empty")
    return `release/mobile-v${version} already has this change.`;
  if (pick !== "ok")
    return `It does not apply cleanly to release/mobile-v${version}: ${pick.join(", ")} conflict.`;
  if (baseRuntime !== patchedRuntime)
    return `It changes the native fingerprint (${baseRuntime} to ${patchedRuntime}): a native change needs a release, not an update.`;
  return null;
}

function planComment({ version, runtime, refusal, plan, smoke, runUrl }) {
  const head = "<!-- ota-plan -->\n";
  if (refusal) return `${head}**Can't publish an OTA hotfix:** ${refusal}`;
  if (plan !== "success" || smoke !== "success") {
    const failed =
      plan !== "success"
        ? "the plan, or typecheck, lint or unit tests on the patched release branch,"
        : "the Maestro smoke on the patched release branch";
    return `${head}**Can't publish an OTA hotfix:** ${failed} failed: ${runUrl}`;
  }
  return `${head}On merge, publishes an OTA hotfix to ${version} (runtime \`${runtime}\`): to \`preview\`, then promoted to \`production\`.`;
}

function resolveRuntime(mobile) {
  execFileSync("npm", ["ci", "--no-audit", "--no-fund"], {
    cwd: mobile,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const out = execFileSync(
    "npx",
    ["expo-updates", "runtimeversion:resolve", "--platform", "android"],
    { cwd: mobile, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  return JSON.parse(out).runtimeVersion;
}

function plan(dir, commit) {
  const git = (...args) =>
    execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }).trim();
  const version = latestRelease(git("tag", "--list", "mobile-v*").split("\n"));
  const changed = git(
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    commit,
  ).split("\n");
  const out = { version: version ?? "", base: "", runtime: "", refusal: "" };
  const early = planRefusal({ version, changed, pick: "ok" });
  if (early) return { ...out, refusal: early };

  const branch = `release/mobile-v${version}`;
  const hasBranch =
    spawnSync("git", ["rev-parse", "--verify", "-q", `origin/${branch}`])
      .status === 0;
  out.base = git(
    "rev-parse",
    `${hasBranch ? `origin/${branch}` : `mobile-v${version}`}^{commit}`,
  );
  git("worktree", "add", "-B", branch, dir, out.base);
  const baseRuntime = resolveRuntime(join(dir, "mobile"));

  let pick = "ok";
  if (
    spawnSync("git", ["-C", dir, "cherry-pick", "-x", commit], {
      stdio: "inherit",
    }).status !== 0
  ) {
    const conflicts = git("-C", dir, "diff", "--name-only", "--diff-filter=U");
    pick = conflicts ? conflicts.split("\n") : "empty";
    spawnSync("git", ["-C", dir, "cherry-pick", "--abort"]);
  }
  const patchedRuntime =
    pick === "ok" ? resolveRuntime(join(dir, "mobile")) : baseRuntime;
  out.runtime = patchedRuntime;
  out.refusal =
    planRefusal({ version, changed, pick, baseRuntime, patchedRuntime }) ?? "";
  return out;
}

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "plan") {
    const result = plan(args[0], args[1]);
    for (const [k, v] of Object.entries(result)) console.log(`${k}=${v}`);
  } else if (cmd === "comment") {
    const e = process.env;
    console.log(
      planComment({
        version: e.VERSION,
        runtime: e.RUNTIME,
        refusal: e.REFUSAL,
        plan: e.PLAN,
        smoke: e.SMOKE,
        runUrl: e.RUN_URL,
      }),
    );
  } else {
    console.error("usage: ota-hotfix.js plan <dir> <commit> | comment");
    process.exit(2);
  }
}

module.exports = { latestRelease, planComment, planRefusal };

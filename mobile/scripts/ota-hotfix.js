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
//
//   node scripts/ota-hotfix.js gate publish|rollback
//     Prints why this run may not publish or roll back, or nothing: from
//     ACTOR, TRIGGERING_ACTOR and OWNER, and for a publish CHECK_RUNS (a file
//     of the PR head's ota-plan check runs, as a JSON array) and HEAD. A
//     missing value refuses.
const { execFileSync, spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// What this script prints lands in $GITHUB_OUTPUT and `::error::` lines, where
// a newline in a path (which git prints raw under -z) would start a new
// output or workflow command.
const oneLine = (text) => text.replace(/[\u0000-\u001f\u007f]/g, "?");

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
    return `It also changes api/ (${oneLine(api.join(", "))}), which deploys on the same merge: land the API change first, in its own PR.`;
  if (!changed.some((f) => /^(mobile|shared)\//.test(f)))
    return "It changes nothing under mobile/ or shared/, so an update would carry nothing.";
  if (pick === "empty")
    return `release/mobile-v${version} already has this change.`;
  if (pick !== "ok")
    return `It does not apply cleanly to release/mobile-v${version}: ${oneLine(pick.join(", "))} conflict.`;
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

// A merge or dispatch by the owner, and no re-run by anyone else: a re-run
// keeps github.actor but reads the label as it is then.
function actorRefusal({ actor, triggeringActor, owner }) {
  if (owner && actor === owner && triggeringActor === owner) return null;
  const other = actor === owner ? triggeringActor : actor;
  return `${other || "Someone unknown"} started this run, and only ${owner} publishes or rolls back an OTA update. To publish it, follow docs/operations/mobile-release.md, OTA hotfixes, By hand.`;
}

// The ota-plan job GitHub Actions ran last on the PR's head. Only its result
// counts: an event with the label off leaves a skipped run, a plan still
// running has no conclusion yet (the job lasts as long as its run), a
// superseded or stopped one is cancelled, and any App with checks: write
// could post a check run of the same name. A PR that edits ota-plan.yml decides what
// that job runs; the refusals that matter run again at publish.
const GITHUB_ACTIONS_APP_ID = 15368;
function planCheckRefusal(checkRuns, head) {
  const last = checkRuns
    .filter(
      (r) =>
        r.name === "ota-plan" &&
        r.app?.id === GITHUB_ACTIONS_APP_ID &&
        r.conclusion !== "skipped",
    )
    // By id, which is the order GitHub made them in, and the newest is the
    // one the main ruleset reads too. Start times do not order them: a run
    // cancelled before it started can carry the time it was cancelled.
    .sort((a, b) => a.id - b.id)
    .at(-1);
  if (last?.conclusion === "success") return null;
  const state = last ? (last.conclusion ?? "still running") : "missing";
  return `its ota-plan check on ${head} is ${state}.`;
}

// `mode` is "publish" or "rollback"; `env` holds the values named above.
function gateRefusal(mode, env, read = (f) => readFileSync(f, "utf8")) {
  if (mode !== "publish" && mode !== "rollback")
    return `Unknown gate "${mode}": publish or rollback.`;
  const byActor = actorRefusal({
    actor: env.ACTOR,
    triggeringActor: env.TRIGGERING_ACTOR,
    owner: env.OWNER,
  });
  if (byActor || mode === "rollback") return byActor;
  if (!env.CHECK_RUNS || !env.HEAD)
    return "The gate was given no ota-plan check runs to read.";
  return planCheckRefusal(JSON.parse(read(env.CHECK_RUNS)), env.HEAD);
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
  // -z: by default git quotes a path with non-ASCII bytes ("api/\303\251.ts").
  const paths = (out) => out.split("\0").filter(Boolean);
  const changed = paths(
    git("diff-tree", "-z", "--no-commit-id", "--name-only", "-r", commit),
  );
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
    // Its stdout goes to stderr: this script's stdout is $GITHUB_OUTPUT.
    spawnSync("git", ["-C", dir, "cherry-pick", "-x", commit], {
      stdio: ["ignore", 2, "inherit"],
    }).status !== 0
  ) {
    const conflicts = paths(
      git("-C", dir, "diff", "-z", "--name-only", "--diff-filter=U"),
    );
    pick = conflicts.length > 0 ? conflicts : "empty";
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
    for (const [k, v] of Object.entries(result))
      console.log(`${k}=${oneLine(v)}`);
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
  } else if (cmd === "gate") {
    const refusal = gateRefusal(args[0], process.env);
    if (refusal) console.log(oneLine(refusal));
  } else {
    console.error(
      "usage: ota-hotfix.js plan <dir> <commit> | comment | gate publish|rollback",
    );
    process.exit(2);
  }
}

module.exports = {
  actorRefusal,
  gateRefusal,
  latestRelease,
  planCheckRefusal,
  planComment,
  planRefusal,
};

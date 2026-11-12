import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  actorRefusal,
  gateRefusal,
  latestRelease,
  planCheckRefusal,
  planComment,
  planRefusal,
} from "../scripts/ota-hotfix";

// The automated OTA hotfix lane: docs/operations/mobile-release.md, and
// docs/decisions/0046-ota-hotfixes-publish-from-ci-on-a-labelled-merge.md.
describe("OTA hotfix plan", () => {
  // Mutation: compare versions as strings, or let a release candidate through.
  it("targets the newest release tag, never a candidate", () => {
    expect(
      latestRelease([
        "mobile-v0.9.0",
        "mobile-v0.10.0",
        "mobile-v0.10.1-rc.1",
        "maplibre-android-v1.0.0",
      ]),
    ).toBe("0.10.0");
    expect(latestRelease(["mobile-v1.0.0-rc.1", ""])).toBeNull();
  });

  const ok = {
    version: "1.2.0",
    changed: ["mobile/src/a.ts"],
    pick: "ok" as const,
    baseRuntime: "abc",
    patchedRuntime: "abc",
  };

  it("lets a clean JavaScript-only fix through", () => {
    expect(planRefusal(ok)).toBeNull();
    expect(planRefusal({ ...ok, changed: ["shared/src/a.ts"] })).toBeNull();
  });

  // Mutation: drop any one condition in planRefusal.
  it("refuses what an update must not carry", () => {
    expect(planRefusal({ ...ok, version: null })).toMatch(/no build/);
    expect(
      planRefusal({ ...ok, changed: ["mobile/src/a.ts", "api/src/b.ts"] }),
    ).toMatch(/api\/src\/b\.ts/);
    expect(planRefusal({ ...ok, changed: ["frontend/src/a.ts"] })).toMatch(
      /nothing under mobile/,
    );
    expect(planRefusal({ ...ok, pick: "empty" })).toMatch(/already has/);
    expect(planRefusal({ ...ok, pick: ["mobile/src/a.ts"] })).toMatch(
      /mobile\/src\/a\.ts conflict/,
    );
    expect(planRefusal({ ...ok, patchedRuntime: "def" })).toMatch(
      /needs a release/,
    );
  });

  // Mutation: post the go-ahead when the plan or the smoke failed.
  it("promises a publish only when every check passed", () => {
    const plan = {
      version: "1.2.0",
      runtime: "abc",
      refusal: "",
      plan: "success",
      smoke: "success",
      runUrl: "https://example.invalid/run",
    };
    expect(planComment(plan)).toMatch(
      /^<!-- ota-plan -->\nOn merge.*1\.2\.0.*abc/,
    );
    expect(planComment({ ...plan, refusal: "No tag." })).toMatch(
      /Can't publish.*No tag\./,
    );
    expect(planComment({ ...plan, plan: "failure" })).toMatch(/Can't publish/);
    expect(planComment({ ...plan, smoke: "cancelled" })).toMatch(/Maestro/);
  });

  // Mutation: check only github.actor, or only github.triggering_actor.
  it("lets only the owner publish or roll back, re-runs included", () => {
    const owner = "maintainer";
    expect(
      actorRefusal({ actor: owner, triggeringActor: owner, owner }),
    ).toBeNull();
    expect(
      actorRefusal({ actor: "writer", triggeringActor: owner, owner }),
    ).toMatch(/writer started this run/);
    expect(
      actorRefusal({ actor: owner, triggeringActor: "writer", owner }),
    ).toMatch(/writer started this run/);
  });

  // Mutation: let a missing actor or owner through (a dropped or misspelt
  // env line in a workflow), or skip the plan check when CHECK_RUNS is unset.
  it("refuses when the gate is missing what it decides on", () => {
    expect(
      actorRefusal({
        actor: undefined,
        triggeringActor: undefined,
        owner: undefined,
      }),
    ).not.toBeNull();
    expect(
      actorRefusal({ actor: "", triggeringActor: "", owner: "" }),
    ).not.toBeNull();
    const owner = { ACTOR: "o", TRIGGERING_ACTOR: "o", OWNER: "o" };
    expect(gateRefusal("rollback", owner)).toBeNull();
    expect(gateRefusal("publish", owner)).toMatch(/no ota-plan check runs/);
    expect(
      gateRefusal("publish", { ...owner, CHECK_RUNS: "runs.json" }),
    ).toMatch(/no ota-plan check runs/);
    expect(gateRefusal("", owner)).toMatch(/Unknown gate/);
    const runs = JSON.stringify([
      {
        name: "ota-plan",
        app: { id: 15368 },
        conclusion: "success",
        started_at: "2026-11-07T01:00:00Z",
      },
    ]);
    expect(
      gateRefusal(
        "publish",
        { ...owner, CHECK_RUNS: "runs.json", HEAD: "abc" },
        () => runs,
      ),
    ).toBeNull();
    expect(
      gateRefusal(
        "publish",
        { ...owner, ACTOR: "w", CHECK_RUNS: "runs.json", HEAD: "abc" },
        () => runs,
      ),
    ).toMatch(/w started/);
  });

  // Mutation: print a path as git gives it under -z, newline and all.
  it("keeps every refusal on one line", () => {
    const evil = "api/a\nrefusal=\nz";
    expect(
      planRefusal({ ...ok, changed: ["mobile/src/a.ts", evil] }),
    ).not.toMatch(/\n/);
    expect(planRefusal({ ...ok, pick: [evil] })).not.toMatch(/\n/);
  });

  // Mutation: drop the app filter or the skipped filter, sort by
  // completed_at, or let a run with no conclusion through.
  it("publishes only on GitHub Actions' latest finished ota-plan pass", () => {
    const run = (
      conclusion: string | null,
      started_at: string | null,
      app = 15368,
    ) => ({
      name: "ota-plan",
      app: { id: app },
      conclusion,
      started_at,
      // As GitHub reports it: none until the run finishes.
      completed_at: conclusion ? started_at : null,
    });
    const pass = run("success", "2026-11-07T01:00:00Z");
    expect(planCheckRefusal([pass], "abc")).toBeNull();
    expect(planCheckRefusal([], "abc")).toMatch(/abc is missing/);
    expect(
      planCheckRefusal([pass, run("skipped", "2026-11-07T02:00:00Z")], "abc"),
    ).toBeNull();
    expect(
      planCheckRefusal([run("failure", "2026-11-07T00:00:00Z", 999)], "abc"),
    ).toMatch(/missing/);
    expect(
      planCheckRefusal(
        [
          run("failure", "2026-11-07T00:00:00Z"),
          run("success", "2026-11-07T00:00:00Z", 999),
        ],
        "abc",
      ),
    ).toMatch(/failure/);
    // A re-run in progress has started but not finished.
    expect(
      planCheckRefusal([pass, run(null, "2026-11-07T02:00:00Z")], "abc"),
    ).toMatch(/still running/);
    expect(planCheckRefusal([pass, run(null, null)], "abc")).toMatch(
      /still running/,
    );
  });

  // Mutation: drop the gate call from either workflow, move it after the step
  // that publishes or rolls back, drop its `exit 1`, its CHECK_RUNS or HEAD,
  // an actor env line, or an actor clause from either job's `if:`.
  it("runs the gate before every publish and rollback", () => {
    const workflow = (name: string) =>
      readFileSync(join(__dirname, "../../.github/workflows", name), "utf8");
    const actorEnv = [
      "ACTOR: ${{ github.actor }}",
      "TRIGGERING_ACTOR: ${{ github.triggering_actor }}",
      "OWNER: ${{ github.repository_owner }}",
    ];
    const owner =
      "github.actor == github.repository_owner && github.triggering_actor == github.repository_owner";
    const between = (text: string, from: string, to: string) => {
      const start = text.indexOf(from);
      const end = text.indexOf(to, start);
      expect(start, from).toBeGreaterThan(-1);
      expect(end, to).toBeGreaterThan(start);
      return text.slice(start, end);
    };

    const hotfix = workflow("ota-hotfix.yml");
    const find = between(hotfix, "\n  find:\n", "\n  publish:\n");
    for (const line of actorEnv) expect(find).toContain(line);
    const gated = between(
      find,
      'refusal=$(CHECK_RUNS="$RUNNER_TEMP/runs.json" HEAD="$head" node mobile/scripts/ota-hotfix.js gate publish)',
      'echo "pr=$number"',
    );
    expect(gated).toMatch(/if \[ -n "\$refusal" \]; then[^]*exit 1\n {10}fi\n/);
    const publishIf = between(hotfix, "\n  publish:\n", "runs-on:");
    expect(publishIf.replace(/\s+/g, " ")).toContain(
      `needs.find.outputs.pr != '' && ${owner}`,
    );

    const rollback = workflow("ota-rollback.yml");
    expect(between(rollback, "\n  rollback:\n", "runs-on:")).toContain(
      `if: ${owner}\n`,
    );
    const step = between(
      rollback,
      "- name: Only the owner rolls back",
      'eas update:rollback "$GROUP"',
    );
    for (const line of actorEnv) expect(step).toContain(line);
    expect(step).toContain(
      'refusal=$(node mobile/scripts/ota-hotfix.js gate rollback)\n          if [ -n "$refusal" ]; then echo "::error::$refusal"; exit 1; fi\n',
    );
  });

  // `ota-plan` is a required check, and the ruleset reads the newest check of
  // that name: a skipped one passes, and a job has no check until the jobs it
  // `needs` finish. So the plan runs on every event while the label is on
  // (were it to skip on some, as it once did when another label was added,
  // that event would turn a red plan green), one run at a time, and the
  // `ota-plan` job has no `needs`: it starts with the run and waits for
  // `verdict`, so a plan in progress shows as one.
  // Mutation: add an event test such as `github.event.action != 'labeled'` to
  // the plan's `if:`, drop `opened` or `unlabeled` from the trigger, put
  // anything but the PR number in the concurrency group, give the `ota-plan`
  // job a `needs:`, or have it pass on anything but verdict's success.
  it("plans on every event while the label is on, and shows as running until the verdict", () => {
    const plan = readFileSync(
      join(__dirname, "../../.github/workflows/ota-plan.yml"),
      "utf8",
    );
    const labelled =
      "    if: contains(github.event.pull_request.labels.*.name, 'ota-hotfix')\n    runs-on:";
    expect(plan).toContain(
      "    types: [opened, reopened, synchronize, labeled, unlabeled]\n",
    );
    expect(plan).toContain(`\n  plan:\n${labelled}`);
    expect(plan).toContain(
      "concurrency:\n  group: ota-plan-${{ github.event.pull_request.number }}\n  cancel-in-progress: true\n",
    );
    expect(plan).toContain(
      "\n  verdict:\n    needs: [plan, smoke]\n    if: ${{ !cancelled() && needs.plan.result != 'skipped' }}\n",
    );
    const reporter = plan.slice(plan.indexOf(`\n  ota-plan:\n${labelled}`));
    expect(reporter.startsWith("\n  ota-plan:\n")).toBe(true);
    expect(reporter).not.toMatch(/^ {4}needs:/m);
    expect(reporter).toContain(
      'select(.name == "verdict" and .status == "completed") | .conclusion] | last // empty',
    );
    expect(reporter.trimEnd().endsWith('[ "$verdict" = success ]')).toBe(true);
  });
});

// The CLI against a real repository, with a stand-in for expo-updates whose
// runtime version is mobile/native.txt. ota-plan.yml and ota-hotfix.yml write
// its stdout to $GITHUB_OUTPUT, which fails on any line that isn't key=value.
describe("ota-hotfix.js plan", () => {
  const script = join(__dirname, "../scripts/ota-hotfix.js");
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.invalid",
  };
  let root: string;
  let repo: string;
  const sh = (cmd: string, args: string[], cwd = repo) =>
    execFileSync(cmd, args, { cwd, env, encoding: "utf8" }).trim();
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  // A commit off the tag that changes the given files.
  const fix = (name: string, files: Record<string, string>) => {
    sh("git", ["switch", "-q", "-c", name, "mobile-v1.0.0"]);
    for (const [path, text] of Object.entries(files)) write(path, text);
    sh("git", ["add", "-A"]);
    sh("git", ["commit", "-q", "-m", name]);
    return sh("git", ["rev-parse", "HEAD"]);
  };
  const plan = (name: string, commit: string) => {
    const dir = join(root, name);
    const out = sh("node", [script, "plan", dir, commit]);
    for (const line of out.split("\n")) expect(line).toMatch(/^[a-z]+=/);
    const result: Record<string, string> = Object.fromEntries(
      out
        .split("\n")
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
    // One plan per runner in CI; here the next case needs the branch name.
    if (result.base) {
      result.branch = sh("git", ["-C", dir, "branch", "--show-current"]);
      sh("git", ["worktree", "remove", "--force", dir]);
      sh("git", ["branch", "-D", result.branch]);
    }
    return result;
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "ota-hotfix-"));
    repo = join(root, "repo");
    mkdirSync(repo);
    sh("git", ["init", "-q", "-b", "main"]);
    write(".gitignore", "node_modules/\n");
    write(
      "fake-expo-updates/package.json",
      JSON.stringify({
        name: "expo-updates",
        version: "0.0.0",
        bin: { "expo-updates": "cli.js" },
      }),
    );
    write(
      "fake-expo-updates/cli.js",
      '#!/usr/bin/env node\nconsole.log(JSON.stringify({ runtimeVersion: require("fs").readFileSync("native.txt", "utf8").trim() }));\n',
    );
    write(
      "mobile/package.json",
      JSON.stringify({
        name: "m",
        version: "1.0.0",
        dependencies: { "expo-updates": "file:../fake-expo-updates" },
      }),
    );
    write("mobile/native.txt", "abc\n");
    write("mobile/src/a.ts", "export const a = 1;\n");
    sh(
      "npm",
      ["install", "--no-audit", "--no-fund", "--offline"],
      join(repo, "mobile"),
    );
    sh("git", ["add", "-A"]);
    sh("git", ["commit", "-q", "-m", "release"]);
    sh("git", ["tag", "mobile-v1.0.0"]);
  }, 60_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  // Mutation: let the cherry-pick's stdout reach this script's stdout.
  it("picks a JavaScript fix onto the release and prints only outputs", () => {
    const result = plan(
      "js",
      fix("js", { "mobile/src/a.ts": "export const a = 2;\n" }),
    );
    expect(result).toMatchObject({
      version: "1.0.0",
      runtime: "abc",
      refusal: "",
    });
    expect(result.branch).toBe("release/mobile-v1.0.0");
  }, 60_000);

  it("refuses a native change", () => {
    const result = plan(
      "native",
      fix("native", { "mobile/native.txt": "def\n" }),
    );
    expect(result.refusal).toMatch(/abc to def/);
  }, 60_000);

  // Mutation: drop -z from the diff-tree call (git quotes the path).
  it("refuses an API change even under a non-ASCII name", () => {
    const result = plan(
      "api",
      fix("api", {
        "mobile/src/a.ts": "export const a = 3;\n",
        "api/é.ts": "x\n",
      }),
    );
    expect(result.refusal).toMatch(/api\/é\.ts/);
  }, 60_000);

  it("refuses a fix that conflicts with an earlier hotfix", () => {
    const earlier = fix("earlier", {
      "mobile/src/a.ts": "export const a = 4;\n",
    });
    sh("git", [
      "update-ref",
      "refs/remotes/origin/release/mobile-v1.0.0",
      earlier,
    ]);
    const result = plan(
      "conflict",
      fix("conflict", { "mobile/src/a.ts": "export const a = 5;\n" }),
    );
    expect(result.refusal).toMatch(/mobile\/src\/a\.ts conflict/);
    sh("git", [
      "update-ref",
      "-d",
      "refs/remotes/origin/release/mobile-v1.0.0",
    ]);
  }, 60_000);
});

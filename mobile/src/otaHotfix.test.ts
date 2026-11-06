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

  // Mutation: drop the gate call from either workflow, or move it after the
  // step that publishes or rolls back.
  it("runs the gate before every publish and rollback", () => {
    const workflow = (name: string) =>
      readFileSync(join(__dirname, "../../.github/workflows", name), "utf8");
    const hotfix = workflow("ota-hotfix.yml");
    const gate = hotfix.indexOf("node mobile/scripts/ota-hotfix.js gate");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(hotfix.indexOf('echo "pr=$number"'));
    expect(hotfix).toMatch(
      /\n {2}publish:\n {4}needs: find\n {4}if: needs\.find\.outputs\.pr != ''\n/,
    );
    const rollback = workflow("ota-rollback.yml");
    const rollbackGate = rollback.indexOf(
      "node mobile/scripts/ota-hotfix.js gate",
    );
    expect(rollbackGate).toBeGreaterThan(-1);
    expect(rollbackGate).toBeLessThan(
      rollback.indexOf('eas update:rollback "$GROUP"'),
    );
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

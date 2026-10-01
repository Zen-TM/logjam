// node --test infra/scripts/plan-summary.test.mjs
// The guards behind merge = apply for envs/prod and envs/github: a destroy is
// never cut from the PR comment, the apply refuses any plan other than the one
// read, and a PR is applied for exactly the roots it was planned for.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { check, comment, fingerprint, header, inScope, MAX_COMMENT, readFingerprint } from "./plan-summary.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), "utf8"));
const SHA = "0123456789abcdef0123456789abcdef01234567";

test("a delete in the truncated part of the plan text is still in the header", () => {
  // Mutation: header() listing only updates, or comment() keeping the head
  // instead of the header, turns this red.
  const plan = fixture("plan-late-delete");
  const planText = "  # module.media.aws_s3_bucket.this will be destroyed\n" + "  ~ update\n".repeat(20000);
  const { body, ok } = comment({ root: "prod", planText, status: "success", plan, sha: SHA });
  assert.ok(ok);
  assert.ok(body.length <= MAX_COMMENT, `comment is ${body.length} chars`);
  assert.ok(!body.includes("will be destroyed"), "the fixture's delete must sit in the cut part");
  assert.match(body, /\*\*Destroys \(1\):\*\*\n- `module\.media\.aws_s3_bucket\.this` — delete/);
  assert.match(body, /~ update\n+```$/, "the tail is kept");
});

test("header lists counts, then every delete and replace", () => {
  const h = header(fixture("plan-mixed"), "prod");
  assert.match(h, /^\*\*Plan:\*\* 1 to create, 2 to update, 1 to replace, 1 to delete, 1 to import$/m);
  assert.match(h, /`aws_s3_bucket_versioning\.media` — replace/);
  assert.match(h, /`module\.access_logs\.aws_s3_bucket_lifecycle_configuration\.this\[0\]` — delete/);
  assert.equal(header(fixture("plan-no-changes"), "prod"), "**Plan:** no changes");
});

test("fingerprint ignores resource order", () => {
  assert.equal(fingerprint(fixture("plan-mixed"), "prod"), fingerprint(fixture("plan-mixed-reordered"), "prod"));
});

test("fingerprint changes when one resource's actions change", () => {
  // Mutation: hashing addresses only turns this red.
  assert.notEqual(fingerprint(fixture("plan-mixed"), "prod"), fingerprint(fixture("plan-mixed-one-action-differs"), "prod"));
});

test("fingerprint changes when the Lambda build differs", () => {
  // Both plans say "update" on the Lambda; only the artifact hash differs.
  assert.notEqual(fingerprint(fixture("plan-mixed"), "prod"), fingerprint(fixture("plan-mixed-other-lambda-build"), "prod"));
});

test("a failed plan posts no fingerprint", () => {
  const { body, ok } = comment({ root: "prod", planText: "Error: boom", status: "failure", plan: null, sha: SHA });
  assert.equal(ok, false);
  assert.equal(readFingerprint(body), null);
});

test("a destroy list too long to fit posts no fingerprint", () => {
  const plan = fixture("plan-late-delete");
  const { body, ok } = comment({ root: "prod", planText: "x".repeat(5000), status: "success", plan, sha: SHA, max: 1200 });
  assert.equal(ok, false);
  assert.equal(readFingerprint(body), null);
});

test("check applies only the plan that was read", () => {
  const read = comment({ root: "prod", planText: "plan", status: "success", plan: fixture("plan-mixed"), sha: SHA }).body;
  assert.equal(check("prod", fixture("plan-mixed-reordered"), read, SHA).ok, true);
  const moved = check("prod", fixture("plan-mixed-one-action-differs"), read, SHA);
  assert.equal(moved.ok, false);
  assert.match(moved.reason, /main moved .* or AWS changed outside Terraform/);
  assert.match(check("prod", fixture("plan-mixed"), read, "f".repeat(40)).reason, /plan for the final commit never posted/);
  assert.match(check("prod", fixture("plan-mixed"), "", SHA).reason, /no successful plan comment/);
});

test("check refuses a plan that edits the apply role", () => {
  const plan = fixture("plan-self-change");
  const read = comment({ root: "prod", planText: "plan", status: "success", plan, sha: SHA }).body;
  const out = check("prod", plan, read, SHA);
  assert.equal(out.ok, false);
  assert.match(out.reason, /aws_iam_policy\.github_actions_apply_boundary/);
  assert.match(header(plan, "prod"), /Changes the apply role itself/);
});

test("a comment for another root is not this root's plan", () => {
  // An empty plan has the same fingerprint in every root. Mutation: check()
  // reading the fingerprint without matching the marker turns this red.
  const plan = fixture("plan-no-changes");
  const prodComment = comment({ root: "prod", planText: "plan", status: "success", plan, sha: SHA }).body;
  assert.equal(check("prod", plan, prodComment, SHA).ok, true);
  const out = check("github", plan, prodComment, SHA);
  assert.equal(out.ok, false);
  assert.match(out.reason, /no successful plan comment/);
});

test("the apply-role guard is envs/prod's alone", () => {
  // envs/github has no resource of that name; its plans never trip the guard.
  const plan = fixture("plan-self-change");
  const read = comment({ root: "github", planText: "plan", status: "success", plan, sha: SHA }).body;
  assert.equal(check("github", plan, read, SHA).ok, true);
  assert.doesNotMatch(header(plan, "github"), /Changes the apply role itself/);
});

test("each root plans and applies exactly its own changes", () => {
  // The plan and apply workflows both ask inScope(): a root applied without
  // having been planned refuses, so the two must agree. Mutation: widening
  // prod's scope to all of infra/terraform/ turns this red.
  const cases = [
    ["infra/terraform/envs/prod/s3.tf", true, false],
    ["infra/terraform/modules/storage/main.tf", true, false],
    ["infra/terraform/templates/env.local.tftpl", true, false],
    ["infra/terraform/bootstrap/main.tf", false, false],
    ["infra/terraform/envs/local/main.tf", false, false],
    ["infra/lambda/cognito-email-sender/src/index.ts", true, false],
    ["infra/terraform/envs/github/rulesets.tf", false, true],
    ["infra/scripts/plan-summary.mjs", true, true],
    [".github/workflows/terraform-apply.yml", true, true],
    ["frontend/src/App.tsx", false, false],
  ];
  for (const [path, prod, github] of cases) {
    assert.equal(inScope("prod", [path]), prod, `prod: ${path}`);
    assert.equal(inScope("github", [path]), github, `github: ${path}`);
  }
});

// What #143's merge saw: the same ruleset, read by the plan App (no
// bypass_actors) and by the apply App (the live admin bypass).
const ADMIN = [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }];
const ruleset = (address, before, after, actions = ["update"]) => ({
  address,
  type: "github_repository_ruleset",
  change: { actions, before, after, after_unknown: {}, importing: { id: "x" } },
});
const live = { name: "mobile-release-tags", etag: "W/1", rules: [{ creation: true }] };
const asPlanApp = (after = { ...live, bypass_actors: ADMIN }) => ({
  resource_changes: [ruleset("github_repository_ruleset.tags", { ...live, bypass_actors: [] }, after)],
});
const asApplyApp = (after = { ...live, bypass_actors: ADMIN }) => ({
  resource_changes: [
    ruleset("github_repository_ruleset.tags", { ...live, bypass_actors: ADMIN }, after, ["no-op"]),
  ],
});

test("bypass_actors the plan App cannot read do not split the plan from the apply", () => {
  // Mutation: dropping github's `unreadable` (or the no-op rule in kind())
  // makes the plan App's view an update and the apply's a no-op: red.
  assert.equal(fingerprint(asPlanApp(), "github"), fingerprint(asApplyApp(), "github"));
  const read = comment({ root: "github", planText: "plan", status: "success", plan: asPlanApp(), sha: SHA }).body;
  assert.equal(check("github", asApplyApp(), read, SHA).ok, true);
  assert.match(header(asPlanApp(), "github"), /\*\*Plan:\*\* 1 to import/);
  assert.match(header(asPlanApp(), "github"), /Counted as no change \(1\)[^]*`bypass_actors`[^]*github_repository_ruleset\.tags/);
});

test("a configured bypass_actors change still changes the fingerprint", () => {
  // Mutation: leaving the configured values out of the fingerprint lets an
  // apply add a bypass actor the PR's plan never had: red.
  const wider = { ...live, bypass_actors: [...ADMIN, { actor_id: 1, actor_type: "Team", bypass_mode: "always" }] };
  assert.notEqual(fingerprint(asPlanApp(), "github"), fingerprint(asPlanApp(wider), "github"));
  const read = comment({ root: "github", planText: "plan", status: "success", plan: asPlanApp(), sha: SHA }).body;
  assert.equal(check("github", asApplyApp(wider), read, SHA).ok, false);
});

test("a real rule change beside the hidden bypass stays an update", () => {
  // Mutation: stripping more than the unreadable attributes hides it: red.
  const changed = { ...live, rules: [{ creation: false }], bypass_actors: ADMIN };
  const h = header(asPlanApp(changed), "github");
  assert.match(h, /1 to update/);
  assert.doesNotMatch(h, /Counted as no change/);
});

test("envs/prod has no unreadable attributes", () => {
  // The same shape in envs/prod is a plain update, and prod fingerprints
  // keep the hash input they had before envs/github existed.
  assert.match(header(asPlanApp(), "prod"), /1 to update/);
  assert.notEqual(fingerprint(asPlanApp(), "prod"), fingerprint(asApplyApp(), "prod"));
});

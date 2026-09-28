// node --test infra/scripts/plan-summary.test.mjs
// The guards behind merge = apply for envs/prod: a destroy is never cut from
// the PR comment, and the apply refuses any plan other than the one read.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { check, comment, fingerprint, header, MAX_COMMENT, readFingerprint } from "./plan-summary.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), "utf8"));
const SHA = "0123456789abcdef0123456789abcdef01234567";

test("a delete in the truncated part of the plan text is still in the header", () => {
  // Mutation: header() listing only updates, or comment() keeping the head
  // instead of the header, turns this red.
  const plan = fixture("plan-late-delete");
  const planText = "  # module.media.aws_s3_bucket.this will be destroyed\n" + "  ~ update\n".repeat(20000);
  const { body, ok } = comment({ planText, status: "success", plan, sha: SHA });
  assert.ok(ok);
  assert.ok(body.length <= MAX_COMMENT, `comment is ${body.length} chars`);
  assert.ok(!body.includes("will be destroyed"), "the fixture's delete must sit in the cut part");
  assert.match(body, /\*\*Destroys \(1\):\*\*\n- `module\.media\.aws_s3_bucket\.this` — delete/);
  assert.match(body, /~ update\n+```$/, "the tail is kept");
});

test("header lists counts, then every delete and replace", () => {
  const h = header(fixture("plan-mixed"));
  assert.match(h, /^\*\*Plan:\*\* 1 to create, 2 to update, 1 to replace, 1 to delete, 1 to import$/m);
  assert.match(h, /`aws_s3_bucket_versioning\.media` — replace/);
  assert.match(h, /`module\.access_logs\.aws_s3_bucket_lifecycle_configuration\.this\[0\]` — delete/);
  assert.equal(header(fixture("plan-no-changes")), "**Plan:** no changes");
});

test("fingerprint ignores resource order", () => {
  assert.equal(fingerprint(fixture("plan-mixed")), fingerprint(fixture("plan-mixed-reordered")));
});

test("fingerprint changes when one resource's actions change", () => {
  // Mutation: hashing addresses only turns this red.
  assert.notEqual(fingerprint(fixture("plan-mixed")), fingerprint(fixture("plan-mixed-one-action-differs")));
});

test("fingerprint changes when the Lambda build differs", () => {
  // Both plans say "update" on the Lambda; only the artifact hash differs.
  assert.notEqual(fingerprint(fixture("plan-mixed")), fingerprint(fixture("plan-mixed-other-lambda-build")));
});

test("a failed plan posts no fingerprint", () => {
  const { body, ok } = comment({ planText: "Error: boom", status: "failure", plan: null, sha: SHA });
  assert.equal(ok, false);
  assert.equal(readFingerprint(body), null);
});

test("a destroy list too long to fit posts no fingerprint", () => {
  const plan = fixture("plan-late-delete");
  const { body, ok } = comment({ planText: "x".repeat(5000), status: "success", plan, sha: SHA, max: 1200 });
  assert.equal(ok, false);
  assert.equal(readFingerprint(body), null);
});

test("check applies only the plan that was read", () => {
  const read = comment({ planText: "plan", status: "success", plan: fixture("plan-mixed"), sha: SHA }).body;
  assert.equal(check(fixture("plan-mixed-reordered"), read, SHA).ok, true);
  const moved = check(fixture("plan-mixed-one-action-differs"), read, SHA);
  assert.equal(moved.ok, false);
  assert.match(moved.reason, /main moved .* or AWS changed outside Terraform/);
  assert.match(check(fixture("plan-mixed"), read, "f".repeat(40)).reason, /plan for the final commit never posted/);
  assert.match(check(fixture("plan-mixed"), "", SHA).reason, /no successful plan comment/);
});

test("check refuses a plan that edits the apply role", () => {
  const plan = fixture("plan-self-change");
  const read = comment({ planText: "plan", status: "success", plan, sha: SHA }).body;
  const out = check(plan, read, SHA);
  assert.equal(out.ok, false);
  assert.match(out.reason, /aws_iam_policy\.github_actions_apply_boundary/);
  assert.match(header(plan), /Changes the apply role itself/);
});

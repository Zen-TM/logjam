#!/usr/bin/env node
// Plan comment, fingerprint and apply check for envs/prod: merge = apply, so
// the plan the maintainer reads on a PR must be the plan that applies.
//
//   plan-summary.mjs comment <plan.txt> <status> [plan.json <sha>]   PR comment body on stdout
//   plan-summary.mjs header <plan.json>                             counts + destroys, markdown
//   plan-summary.mjs check <plan.json> <comment.md> <pr-head-sha>   exit 0 only if safe to apply
//
// The fingerprint hashes the (address, actions) list from `terraform show
// -json`, plus each code artifact's hash, never attribute values: plan JSON
// carries sensitive values in clear, and the comment is public.
// Tests: plan-summary.test.mjs, over __fixtures__/.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MARKER = "<!-- terraform-plan-prod -->";
// GitHub rejects a comment over 65536 chars.
export const MAX_COMMENT = 60000;
// The apply role's boundary denies it editing itself (envs/prod/iam_apply.tf),
// so a plan touching these would fail mid-apply; the maintainer applies it.
const SELF = /\.github_actions_apply(_|\[|$)/;

function kind(actions) {
  const a = actions.join(",");
  if (a === "delete,create" || a === "create,delete") return "replace";
  return a; // create, update, delete, read, forget, no-op
}

function changes(plan) {
  return (plan.resource_changes ?? [])
    .map((rc) => ({
      address: rc.deposed ? `${rc.address} (deposed ${rc.deposed})` : rc.address,
      kind: kind(rc.change.actions),
      importing: Boolean(rc.change.importing),
      rc,
    }))
    .filter((c) => c.kind !== "no-op" || c.importing);
}

export function fingerprint(plan) {
  const list = changes(plan)
    .map((c) => [c.address, c.kind + (c.importing ? "+import" : "")])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  // A Lambda whose code changed is "update" on both sides; its hash is what
  // tells the PR's build from the apply's.
  const artifacts = (plan.resource_changes ?? [])
    .filter((rc) => rc.change.after?.source_code_hash)
    .map((rc) => [rc.address, rc.change.after.source_code_hash])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify({ list, artifacts })).digest("hex");
}

export function header(plan) {
  const all = changes(plan);
  const count = (k) => all.filter((c) => c.kind === k).length;
  const imports = all.filter((c) => c.importing).length;
  const parts = [
    [count("create"), "to create"],
    [count("update"), "to update"],
    [count("replace"), "to replace"],
    [count("delete"), "to delete"],
    [count("forget"), "to forget"],
    [imports, "to import"],
  ].filter(([n]) => n > 0);
  const lines = [parts.length ? `**Plan:** ${parts.map(([n, s]) => `${n} ${s}`).join(", ")}` : "**Plan:** no changes"];
  const destroys = all.filter((c) => ["delete", "replace", "forget"].includes(c.kind));
  if (destroys.length) {
    lines.push("", `**Destroys (${destroys.length}):**`);
    for (const c of destroys) lines.push(`- \`${c.address}\` — ${c.kind}`);
  }
  const self = all.filter((c) => SELF.test(c.rc.address));
  if (self.length) {
    lines.push("", "**Changes the apply role itself** — the workflow will refuse; the maintainer applies this one (infra/AGENTS.md):");
    for (const c of self) lines.push(`- \`${c.address}\``);
  }
  return lines.join("\n");
}

export function comment({ planText, status, plan, sha, max = MAX_COMMENT }) {
  const ok = status === "success" && Boolean(plan);
  const top = [MARKER];
  let fp = "";
  if (ok) {
    fp = fingerprint(plan);
    top.push(`<!-- plan-fingerprint: ${fp} sha: ${sha} -->`);
  }
  top.push(`### Terraform plan — \`envs/prod\` ${ok ? "✅" : "❌ failed"}`, "");
  if (ok) top.push(header(plan), "", `Fingerprint \`${fp.slice(0, 12)}\` at ${sha}`, "");
  const head = top.join("\n");
  const fence = (body) => `${head}\n\`\`\`\n${body}\n\`\`\``;
  if (fence(planText).length <= max) return { body: fence(planText), ok };
  const note = "…(start cut; every delete and replace is listed above)…\n";
  const room = max - fence(note).length;
  if (room < 1000) {
    // The destroy list alone fills the comment: never post one that hides a
    // destroy, and never one the apply would accept.
    return {
      body: [MARKER, "### Terraform plan — `envs/prod` ❌ too many destroys to show", "", "Split this PR."].join("\n"),
      ok: false,
    };
  }
  return { body: fence(note + planText.slice(-room)), ok };
}

export function readFingerprint(body) {
  const m = /<!-- plan-fingerprint: ([0-9a-f]{64}) sha: (\S+) -->/.exec(body ?? "");
  return m ? { fingerprint: m[1], sha: m[2] } : null;
}

// Each refusal says what to do next: the workflow posts it on the merged PR.
export function check(plan, commentBody, headSha) {
  const read = readFingerprint(commentBody);
  if (!read) {
    return { ok: false, reason: "The PR has no successful plan comment, so there is no plan the maintainer read. Nothing applied." };
  }
  if (read.sha !== headSha) {
    return {
      ok: false,
      reason: `The last plan comment is for ${read.sha}, but the PR merged at ${headSha}: the plan for the final commit never posted. Nothing applied; open a PR touching infra/terraform to plan and apply the current diff.`,
    };
  }
  const now = fingerprint(plan);
  if (now !== read.fingerprint) {
    return {
      ok: false,
      reason: [
        `The plan at merge (\`${now.slice(0, 12)}\`) is not the plan on the PR (\`${read.fingerprint.slice(0, 12)}\`). Either main moved after the PR's plan (another apply landed first), or AWS changed outside Terraform since. Nothing applied.`,
        "",
        "The plan it would have applied:",
        "",
        header(plan),
        "",
        "If AWS was changed by hand, undo that and re-run this workflow; otherwise open a PR touching infra/terraform, whose plan shows the whole current diff.",
      ].join("\n"),
    };
  }
  const self = changes(plan).filter((c) => SELF.test(c.rc.address));
  if (self.length) {
    return {
      ok: false,
      reason: `This plan changes the apply role or its boundary (${self.map((c) => c.address).join(", ")}), which that role may not do. Nothing applied; the maintainer applies it from their machine (infra/AGENTS.md).`,
    };
  }
  return { ok: true, reason: "The plan at merge matches the plan on the PR." };
}

function main([cmd, ...args]) {
  const json = (p) => JSON.parse(readFileSync(p, "utf8"));
  if (cmd === "comment") {
    const [txt, status, planJson, sha] = args;
    const plan = status === "success" && planJson ? json(planJson) : null;
    const out = comment({ planText: readFileSync(txt, "utf8"), status, plan, sha });
    process.stdout.write(out.body + "\n");
    return out.ok ? 0 : 1;
  }
  if (cmd === "header") {
    process.stdout.write(header(json(args[0])) + "\n");
    return 0;
  }
  if (cmd === "check") {
    const [planJson, commentFile, sha] = args;
    const out = check(json(planJson), readFileSync(commentFile, "utf8"), sha);
    process.stdout.write(out.reason + "\n");
    return out.ok ? 0 : 1;
  }
  process.stderr.write("usage: plan-summary.mjs comment|header|check …\n");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));

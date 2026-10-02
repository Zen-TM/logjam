#!/usr/bin/env node
// Plan comment, fingerprint and apply check for the roots CI applies on merge
// (envs/prod: AWS; envs/github: the repository's own settings): merge = apply,
// so the plan the maintainer reads on a PR must be the plan that applies.
//
//   plan-summary.mjs scope <root> < changed-paths      exit 0 if the change is in the root's plan
//   plan-summary.mjs comment <root> <plan.txt> <status> [plan.json <sha>]   PR comment body on stdout
//   plan-summary.mjs header <root> <plan.json>                             counts + destroys, markdown
//   plan-summary.mjs check <root> <plan.json> <comment.md> <pr-head-sha> [notice.md]   exit 0 only if safe to apply
//
// PLAN_FINGERPRINT_KEY (a secret) turns on the value check below; PLAN_VALUE_CHECK
// is `enforce` to refuse on a mismatch, anything else only reports one.
//
// The fingerprint hashes the (address, actions) list from `terraform show
// -json`, plus each code artifact's hash, never attribute values: plan JSON
// carries sensitive values in clear, and the comment is public. A root may
// name attributes its plan credentials cannot read (`unreadable`): those are
// left out when deciding a resource's action, and their configured values
// are hashed instead, since both plans take those from the same code.
// Beside it, each created, updated or replaced resource gets an HMAC of its
// planned values, so a hand edit to a resource the PR also changes shows up
// (docs/decisions/0026-plan-fingerprint-covers-planned-values.md). Sensitive and
// unknown values are left out before hashing, the key is never in the repo,
// and no key means no value check, never an unkeyed hash.
// Tests: plan-summary.test.mjs, over __fixtures__/.
import { createHash, createHmac } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// GitHub rejects a comment over 65536 chars.
export const MAX_COMMENT = 60000;

// Changes to the pipeline itself (this script, the plan and apply workflows)
// put every root in scope, so its plan comment is refreshed.
const PIPELINE = String.raw`infra/scripts/plan-summary|\.github/workflows/terraform-(plan|apply)\.yml`;

// The plan and apply workflows both ask `scope`, so a PR is applied for
// exactly the roots it was planned for: a root applied without a plan
// comment refuses.
export const ROOTS = {
  prod: {
    // bootstrap and envs/local are separate roots envs/prod never reads.
    scope: new RegExp(String.raw`^(infra/terraform/(envs/prod|modules|templates)/|infra/lambda/|${PIPELINE})`),
    // The apply role's boundary denies it editing itself (envs/prod/iam_apply.tf),
    // so a plan touching these would fail mid-apply; the maintainer applies it.
    self: /\.github_actions_apply(_|\[|$)/,
    changedOutside: "AWS changed outside Terraform",
    handChange: "If AWS was changed by hand",
    touch: "infra/terraform",
  },
  github: {
    scope: new RegExp(String.raw`^(infra/terraform/envs/github/|${PIPELINE})`),
    self: null,
    // GitHub returns a ruleset's bypass_actors only to a token that may edit
    // it. The PR's plan runs as the read-only plan App, so it sees none and
    // plans to add them; the apply's plan, as the apply App, sees them and
    // plans nothing. Without this, every apply touching such a ruleset would
    // refuse (docs/decisions/0025-github-settings-in-terraform.md).
    unreadable: { github_repository_ruleset: ["bypass_actors"] },
    changedOutside: "a GitHub setting changed outside Terraform",
    handChange: "If a GitHub setting was changed by hand",
    touch: "infra/terraform/envs/github",
  },
};

function root(name) {
  const r = ROOTS[name];
  if (!r) throw new Error(`unknown root ${name}: one of ${Object.keys(ROOTS).join(", ")}`);
  return r;
}

export const marker = (name) => `<!-- terraform-plan-${name} -->`;

export function inScope(name, paths) {
  return paths.some((p) => root(name).scope.test(p));
}

function selfChanges(name, plan) {
  const self = root(name).self;
  return self ? changes(plan, name).filter((c) => self.test(c.rc.address)) : [];
}

// JSON with sorted keys, so equal values compare equal.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

// An update that changes nothing but attributes the plan cannot read, or
// values only known after apply, is no change.
function onlyUnreadable(rc, hidden) {
  const unknown = rc.change.after_unknown ?? {};
  const strip = (v) =>
    Object.fromEntries(Object.entries(v ?? {}).filter(([k]) => !hidden.includes(k) && unknown[k] !== true));
  return canonical(strip(rc.change.before)) === canonical(strip(rc.change.after));
}

function kind(rc, name) {
  const a = rc.change.actions.join(",");
  if (a === "delete,create" || a === "create,delete") return "replace";
  const hidden = root(name).unreadable?.[rc.type];
  if (a === "update" && hidden && onlyUnreadable(rc, hidden)) return "no-op";
  return a; // create, update, delete, read, forget, no-op
}

function changes(plan, name) {
  return (plan.resource_changes ?? [])
    .map((rc) => ({
      address: rc.deposed ? `${rc.address} (deposed ${rc.deposed})` : rc.address,
      kind: kind(rc, name),
      importing: Boolean(rc.change.importing),
      rc,
    }))
    .filter((c) => c.kind !== "no-op" || c.importing);
}

// Updates counted as no change because they touch only unreadable attributes.
function unreadableOnly(plan, name) {
  return (plan.resource_changes ?? []).filter(
    (rc) => rc.change.actions.join(",") === "update" && kind(rc, name) === "no-op",
  );
}

const byAddress = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

export function fingerprint(plan, name) {
  const list = changes(plan, name)
    .map((c) => [c.address, c.kind + (c.importing ? "+import" : "")])
    .sort(byAddress);
  // A Lambda whose code changed is "update" on both sides; its hash is what
  // tells the PR's build from the apply's.
  const artifacts = (plan.resource_changes ?? [])
    .filter((rc) => rc.change.after?.source_code_hash)
    .map((rc) => [rc.address, rc.change.after.source_code_hash])
    .sort(byAddress);
  const unreadable = root(name).unreadable;
  if (!unreadable) return createHash("sha256").update(JSON.stringify({ list, artifacts })).digest("hex");
  // What the code sets an unreadable attribute to is the same in both plans,
  // so a change to it still changes the fingerprint. A hash, never the value.
  const configured = (plan.resource_changes ?? [])
    .filter((rc) => unreadable[rc.type] && rc.change.after)
    .flatMap((rc) =>
      unreadable[rc.type].map((attr) => [
        `${rc.address}.${attr}`,
        createHash("sha256").update(canonical(rc.change.after[attr])).digest("hex"),
      ]),
    )
    .sort(byAddress);
  return createHash("sha256").update(JSON.stringify({ list, artifacts, configured })).digest("hex");
}

// `after` without what `sensitive` marks (true, or a tree shaped like it)
// and what `unknown` marks as only known after apply.
function strip(after, sensitive, unknown) {
  if (sensitive === true || unknown === true) return undefined;
  if (Array.isArray(after)) return after.map((v, i) => strip(v, sensitive?.[i], unknown?.[i]));
  if (after && typeof after === "object") {
    return Object.fromEntries(Object.entries(after).map(([k, v]) => [k, strip(v, sensitive?.[k], unknown?.[k])]));
  }
  return after;
}

// address -> 16 hex of an HMAC over what the plan sets that resource to.
// null without a key. Never the values, and never an unkeyed hash of them.
export function valueFingerprints(plan, name, key) {
  if (!key) return null;
  const out = {};
  for (const c of changes(plan, name)) {
    if (!["create", "update", "replace"].includes(c.kind)) continue;
    const { after, after_sensitive, after_unknown } = c.rc.change;
    out[c.address] = createHmac("sha256", key)
      .update(canonical({ address: c.address, after: strip(after, after_sensitive, after_unknown) }))
      .digest("hex")
      .slice(0, 16);
  }
  return out;
}

// One HTML comment line; < and > are escaped so an address cannot end it.
const encodeValues = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

export function readValues(body) {
  const m = /^<!-- plan-values: (\{.*\}) -->$/m.exec(body ?? "");
  try {
    return m ? JSON.parse(m[1]) : null;
  } catch {
    return null;
  }
}

export const valueMode = (v) => (v === "enforce" ? "enforce" : "report");

export function header(plan, name) {
  const all = changes(plan, name);
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
  const hidden = unreadableOnly(plan, name);
  if (hidden.length) {
    const attrs = [...new Set(hidden.flatMap((rc) => root(name).unreadable[rc.type]))].map((a) => `\`${a}\``);
    lines.push(
      "",
      `**Counted as no change (${hidden.length}):** the plan below shows these updating ${attrs.join(", ")}, which the plan's credentials cannot read. Review those in the code diff; the apply sets them as configured.`,
    );
    for (const rc of hidden) lines.push(`- \`${rc.address}\``);
  }
  const self = selfChanges(name, plan);
  if (self.length) {
    lines.push("", "**Changes the apply role itself** — the workflow will refuse; the maintainer applies this one (infra/AGENTS.md):");
    for (const c of self) lines.push(`- \`${c.address}\``);
  }
  return lines.join("\n");
}

export function comment({ root: name, planText, status, plan, sha, key, max = MAX_COMMENT }) {
  const ok = status === "success" && Boolean(plan);
  const title = `### Terraform plan — \`envs/${name}\``;
  const top = [marker(name)];
  let fp = "";
  if (ok) {
    fp = fingerprint(plan, name);
    top.push(`<!-- plan-fingerprint: ${fp} sha: ${sha} -->`);
    const values = valueFingerprints(plan, name, key);
    if (values) top.push(`<!-- plan-values: ${encodeValues(values)} -->`);
  }
  top.push(`${title} ${ok ? "✅" : "❌ failed"}`, "");
  if (ok) top.push(header(plan, name), "", `Fingerprint \`${fp.slice(0, 12)}\` at ${sha}`, "");
  const head = top.join("\n");
  const fence = (body) => `${head}\n\`\`\`\n${body}\n\`\`\``;
  if (fence(planText).length <= max) return { body: fence(planText), ok };
  const note = "…(start cut; every delete and replace is listed above)…\n";
  const room = max - fence(note).length;
  if (room < 1000) {
    // The destroy list alone fills the comment: never post one that hides a
    // destroy, and never one the apply would accept.
    return {
      body: [marker(name), `${title} ❌ too many destroys to show`, "", "Split this PR."].join("\n"),
      ok: false,
    };
  }
  return { body: fence(note + planText.slice(-room)), ok };
}

export function readFingerprint(body) {
  const m = /<!-- plan-fingerprint: ([0-9a-f]{64}) sha: (\S+) -->/.exec(body ?? "");
  return m ? { fingerprint: m[1], sha: m[2] } : null;
}

// Resources whose planned values now differ from the PR's, or null if the
// two cannot be compared (no key here, or none when the PR was planned).
function valueMismatches(name, plan, commentBody, key) {
  const was = readValues(commentBody);
  const now = valueFingerprints(plan, name, key);
  if (!was || !now) return null;
  return [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((a) => was[a] !== now[a]).sort();
}

// Each refusal says what to do next: the workflow posts it on the merged PR.
// `values` is { key, mode } for the value check; a mismatch refuses only in
// enforce mode, otherwise it comes back as `notice` for the workflow to post.
export function check(name, plan, commentBody, headSha, values = {}) {
  const r = root(name);
  // The fingerprint of an empty plan is the same for every root: only the
  // marker tells this root's comment from another's.
  const read = (commentBody ?? "").includes(marker(name)) ? readFingerprint(commentBody) : null;
  if (!read) {
    return { ok: false, reason: "The PR has no successful plan comment, so there is no plan the maintainer read. Nothing applied." };
  }
  if (read.sha !== headSha) {
    return {
      ok: false,
      reason: `The last plan comment is for ${read.sha}, but the PR merged at ${headSha}: the plan for the final commit never posted. Nothing applied; open a PR touching ${r.touch} to plan and apply the current diff.`,
    };
  }
  const now = fingerprint(plan, name);
  if (now !== read.fingerprint) {
    return {
      ok: false,
      reason: [
        `The plan at merge (\`${now.slice(0, 12)}\`) is not the plan on the PR (\`${read.fingerprint.slice(0, 12)}\`). Either main moved after the PR's plan (another apply landed first), or ${r.changedOutside} since. Nothing applied.`,
        "",
        "The plan it would have applied:",
        "",
        header(plan, name),
        "",
        `${r.handChange}, undo that and re-run this workflow; otherwise open a PR touching ${r.touch}, whose plan shows the whole current diff.`,
      ].join("\n"),
    };
  }
  const enforce = valueMode(values.mode) === "enforce";
  const differ = valueMismatches(name, plan, commentBody, values.key);
  let notice;
  if (differ?.length) {
    const list = differ.map((a) => `- \`${a}\``).join("\n");
    if (enforce) {
      return {
        ok: false,
        reason: [
          `The plan at merge sets different values on ${differ.length} resource(s) the PR's plan also changes:`,
          "",
          list,
          "",
          `${r.changedOutside} since the PR's plan, or main moved. The values are not shown. Nothing applied.`,
          "",
          `${r.handChange}, undo that and re-run this workflow; otherwise open a PR touching ${r.touch}, whose plan shows the whole current diff.`,
        ].join("\n"),
      };
    }
    notice = [
      `**Value check (report only):** the plan at merge sets different values than the PR's plan on ${differ.length} resource(s). Once \`PLAN_VALUE_CHECK\` is \`enforce\` this refuses. The values are not shown.`,
      "",
      list,
    ].join("\n");
  } else if (differ === null) {
    if (enforce) {
      return {
        ok: false,
        reason: "The plan's values cannot be compared: this run has no `PLAN_FINGERPRINT_KEY`, or the PR's plan comment carries no value fingerprints. Nothing applied; open a PR touching " + r.touch + " to plan and apply the current diff.",
      };
    }
    notice = "**Value check (report only):** not run, because this run has no `PLAN_FINGERPRINT_KEY` or the PR's plan comment has no value fingerprints.";
  }
  const self = selfChanges(name, plan);
  if (self.length) {
    return {
      ok: false,
      reason: `This plan changes the apply role or its boundary (${self.map((c) => c.address).join(", ")}), which that role may not do. Nothing applied; the maintainer applies it from their machine (infra/AGENTS.md).`,
    };
  }
  return { ok: true, reason: "The plan at merge matches the plan on the PR.", notice };
}

function main([cmd, name, ...args]) {
  const json = (p) => JSON.parse(readFileSync(p, "utf8"));
  if (cmd === "scope") {
    const paths = readFileSync(0, "utf8").split("\n").filter(Boolean);
    return inScope(name, paths) ? 0 : 1;
  }
  if (cmd === "comment") {
    const [txt, status, planJson, sha] = args;
    const plan = status === "success" && planJson ? json(planJson) : null;
    const key = process.env.PLAN_FINGERPRINT_KEY;
    const out = comment({ root: name, planText: readFileSync(txt, "utf8"), status, plan, sha, key });
    process.stdout.write(out.body + "\n");
    return out.ok ? 0 : 1;
  }
  if (cmd === "header") {
    process.stdout.write(header(json(args[0]), name) + "\n");
    return 0;
  }
  if (cmd === "check") {
    const [planJson, commentFile, sha, noticeFile] = args;
    const values = { key: process.env.PLAN_FINGERPRINT_KEY, mode: process.env.PLAN_VALUE_CHECK };
    const out = check(name, json(planJson), readFileSync(commentFile, "utf8"), sha, values);
    process.stdout.write(out.reason + "\n");
    if (out.notice) {
      process.stdout.write(out.notice + "\n");
      if (noticeFile) writeFileSync(noticeFile, out.notice + "\n");
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.notice + "\n");
    }
    return out.ok ? 0 : 1;
  }
  process.stderr.write("usage: plan-summary.mjs scope|comment|header|check <root> …\n");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));

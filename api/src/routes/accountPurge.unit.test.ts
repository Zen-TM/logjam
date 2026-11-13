// Completeness guard for the account-delete purge in routes/users.ts.
//
// Every model that holds user data through a relation to `User` must either be
// deleted by name in that purge or be listed below as removed only by the
// schema's ON DELETE CASCADE. The failure mode is silence: a new table with a
// `User` relation is wiped by the cascade, but nobody decided that, and its
// recipients' or S3 side is forgotten. The S3 prefixes are held below.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES } from "@logjam/shared";
import { PLAN_PERSON_KEY } from "../lib/planMembership";
import { attributeKey, USER_DATA_S3_HEADS } from "../lib/s3AccessLog";

const read = (...p: string[]) =>
  readFileSync(join(import.meta.dirname, "..", "..", ...p), "utf8");
const schema = read("prisma", "schema.prisma");
const purgeSource = read("src", "routes", "users.ts");

// Rows with no data of their own beyond the link to the account, which the
// cascade removes; the purge deliberately has no line for them.
const REMOVED_BY_CASCADE = ["Share", "FileSendRecipient"];

// Rows that belong to a plan, not to the user who made them, so they outlive
// the account: every `User` relation is SetNull.
const OUTLIVES_ACCOUNT = ["TripPlan", "TripPlanInvite"];

/** model name -> its `User` relation lines (the ones that name the owner). */
function modelsRelatedToUser(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of schema.matchAll(/^model (\w+) \{$([\s\S]*?)^\}$/gm)) {
    const [, name, body] = m;
    if (name === "User") continue;
    const relations = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\w+\s+User\??\s+@relation\(/.test(l));
    if (relations.length > 0) out.set(name, relations);
  }
  return out;
}

/** Models the purge deletes by name: `prisma.<delegate>.deleteMany/delete`. */
function explicitlyPurged(): Set<string> {
  const purge = purgeSource.slice(
    purgeSource.indexOf("accountDeleteTombstones("),
  );
  const names = new Set<string>();
  for (const m of purge.matchAll(/prisma\.(\w+)\.delete(?:Many)?\(/g)) {
    names.add(m[1][0].toUpperCase() + m[1].slice(1));
  }
  return names;
}

describe("account-delete purge covers every model related to User", () => {
  it("finds the models at all — a parser break must not make this vacuous", () => {
    const related = modelsRelatedToUser();
    expect(related.size).toBeGreaterThan(10);
    expect(related.has("Place")).toBe(true);
    expect(explicitlyPurged().has("Place")).toBe(true);
  });

  // Mutation that turns this red: adding a model with a `User` relation (or
  // deleting a deleteMany line from the purge) without naming it in
  // REMOVED_BY_CASCADE.
  it("deletes each one explicitly or names it as removed by the cascade", () => {
    const purged = explicitlyPurged();
    const uncovered = [...modelsRelatedToUser().keys()].filter(
      (model) =>
        !purged.has(model) &&
        !REMOVED_BY_CASCADE.includes(model) &&
        !OUTLIVES_ACCOUNT.includes(model),
    );
    expect(
      uncovered,
      "add a delete to the purge in routes/users.ts (and an S3 leg if it " +
        "holds objects), or list the model in REMOVED_BY_CASCADE",
    ).toEqual([]);
  });

  it("only lists a model as cascade-removed when every User relation cascades", () => {
    const related = modelsRelatedToUser();
    for (const model of REMOVED_BY_CASCADE) {
      const relations = related.get(model);
      expect(relations, `${model} has no User relation`).toBeDefined();
      for (const line of relations!) {
        expect(line, `${model}: ${line}`).toContain("onDelete: Cascade");
      }
      expect(explicitlyPurged().has(model)).toBe(false);
    }
  });

  // Mutation that turns this red: making TripPlan.createdBy cascade, which
  // would delete a group's plan with its creator's account.
  it("only lists a model as outliving the account when every User relation is SetNull", () => {
    const related = modelsRelatedToUser();
    for (const model of OUTLIVES_ACCOUNT) {
      const relations = related.get(model);
      expect(relations, `${model} has no User relation`).toBeDefined();
      for (const line of relations!) {
        expect(line, `${model}: ${line}`).toContain("onDelete: SetNull");
      }
    }
  });
});

// A notification row is held by the recipient, so the cascade from the sender
// never reaches it. The types come from a list of creation sites rather than
// a scan for one spelling, which can miss `type,` from a variable.
//
// Mutations that turn this red: creating a notification in a file not listed
// here, listing a type its file does not create, or a listed type sent to
// another user missing from the purge in routes/users.ts (for the plan
// types, the purge no longer reading PLAN_PERSON_KEY), or a type added to
// NOTIFICATION_TYPES that no site lists and isn't retired (or listed but not
// declared).
describe("account-delete purge covers every notification type", () => {
  // Every file that creates a notification, and the types it creates.
  const CREATION_SITES: Record<string, string[]> = {
    "api/src/lib/egressMeter.ts": [
      "egress_quota_exceeded",
      "egress_quota_warning",
    ],
    "api/src/lib/topoJobReaper.ts": ["topo_failed", "topo_export_complete"],
    "api/src/routes/bulkShare.ts": ["place_shared"],
    "api/src/routes/fileSends.ts": ["file_sent"],
    "api/src/routes/friendInvites.ts": ["friend_request_accepted"],
    "api/src/routes/friends.ts": ["friend_request", "friend_request_accepted"],
    "api/src/lib/planMembership.ts": [
      "plan_invited",
      "plan_join_request",
      "plan_join_approved",
      "plan_member_joined",
      "plan_access_ended",
    ],
    "api/src/routes/shares.ts": ["item_shared"],
    "api/src/routes/sharing.ts": ["place_shared"],
    "api/src/scripts/announce.ts": ["announcement"],
    "topo/worker.py": ["topo_complete", "topo_failed"],
    "topo/export_worker.py": ["topo_export_complete"],
  };
  // Declared because older rows still hold them, but no file creates them now.
  const RETIRED = ["topo_export_skipped"];
  // Only ever sent to the user the row is about, so the purge's
  // `notification.deleteMany({ userId })` already removes them; or, for
  // plan_access_ended, naming no user at all.
  const HELD_BY_OWNER_ONLY = [
    "plan_access_ended",
    "egress_quota_exceeded",
    "egress_quota_warning",
    "topo_complete",
    "topo_failed",
    "topo_export_complete",
    // From no user: the maintainer's script, one row per recipient.
    "announcement",
  ];

  const repo = join(import.meta.dirname, "..", "..", "..");
  const sites: string[] = [];
  const walk = (dir: string, creates: RegExp) => {
    for (const e of readdirSync(join(repo, dir), { withFileTypes: true })) {
      const path = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(path, creates);
      else if (
        /\.(ts|py)$/.test(e.name) &&
        !/(test\.ts|^test_.*\.py)$/.test(e.name) &&
        creates.test(readFileSync(join(repo, path), "utf8"))
      )
        sites.push(path);
    }
  };
  walk("api/src", /notification\.create(Many)?\(/);
  walk("topo", /^\s+create_notification\(/m);

  it("lists every file that creates a notification", () => {
    expect(sites.sort()).toEqual(Object.keys(CREATION_SITES).sort());
  });

  it("lists each type its file creates", () => {
    const missing = Object.entries(CREATION_SITES).flatMap(([file, types]) =>
      types.filter((t) => {
        const src = readFileSync(join(repo, file), "utf8");
        // A string, or a key of an object such as PLAN_PERSON_KEY.
        return !src.includes(`"${t}"`) && !src.includes(`${t}:`);
      }),
    );
    expect(missing).toEqual([]);
  });

  it("lists exactly the declared notification types", () => {
    expect(
      [
        ...new Set([...Object.values(CREATION_SITES).flat(), ...RETIRED]),
      ].sort(),
    ).toEqual([...NOTIFICATION_TYPES].sort());
  });

  // The plan types are named through PLAN_PERSON_KEY, which also says which
  // payload key holds the person; the purge must read it.
  it("names each type sent to another user in the purge", () => {
    const purge = purgeSource.slice(purgeSource.indexOf("$transaction(["));
    const viaPlanMap = purge.includes("PLAN_PERSON_KEY")
      ? Object.keys(PLAN_PERSON_KEY)
      : [];
    const unnamed = [...new Set(Object.values(CREATION_SITES).flat())].filter(
      (t) =>
        !HELD_BY_OWNER_ONLY.includes(t) &&
        !viaPlanMap.includes(t) &&
        !purge.includes(`"${t}"`),
    );
    expect(unnamed).toEqual([]);
  });
});

describe("account-delete purge of topo jobs", () => {
  // deleteTopoJobObjects aborts a job's open upload before deleting its
  // prefixes (lib/topoUpload.unit.test.ts), which a prefix delete alone
  // cannot see. Mutation: purge the topo prefixes with deleteS3Prefix again.
  it("removes each topo job's objects through deleteTopoJobObjects", () => {
    expect(purgeSource).toMatch(
      /topoJobs\.map\(\(\{ id \}\) => deleteTopoJobObjects\(TOPO_BUCKET, id\)\)/,
    );
  });
});

// Every object the API writes sits under a prefix declared in
// USER_DATA_S3_HEADS (lib/s3AccessLog.ts, which also attributes its egress),
// and the purge deletes each one. A cascade never deletes S3 objects.
//
// Mutations that turn this red: a key literal such as `avatars/${userId}/x` in
// any file under src/ (red on the first test); removing the file-sends prefix
// delete, the media keys delete or the exports prefix delete from the purge
// in routes/users.ts, or the inputs/outputs/jobs prefixes from
// deleteTopoJobObjects (red on the third); a head added to
// USER_DATA_S3_HEADS that attributeKey does not switch on (red on the second).
describe("account-delete purge covers every S3 prefix", () => {
  const SRC = join(import.meta.dirname, "..");
  const heads = new Map<string, string[]>();
  const walkSources = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== "__tests__" && name !== "__fixtures__") walkSources(path);
      } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
        const sf = ts.createSourceFile(
          path,
          readFileSync(path, "utf8"),
          ts.ScriptTarget.Latest,
          true,
        );
        const visit = (node: ts.Node): void => {
          // `<head>/${…}`: a key or prefix built from an id.
          const head = ts.isTemplateExpression(node)
            ? /^([a-z][a-z-]*)\/$/.exec(node.head.text)?.[1]
            : undefined;
          if (head) heads.set(head, [...(heads.get(head) ?? []), name]);
          ts.forEachChild(node, visit);
        };
        visit(sf);
      }
    }
  };
  walkSources(SRC);

  // Where the purge names each prefix: the file and what it must contain.
  const PURGED_BY: Record<string, [file: string, pattern: RegExp]> = {
    media: ["routes/users.ts", /deleteS3Keys\(\s*MEDIA_BUCKET,\s*mediaKeys/],
    "file-sends": [
      "routes/users.ts",
      /deleteS3Prefix\(\s*MEDIA_BUCKET,\s*`file-sends\/\$\{user\.id\}\//,
    ],
    exports: [
      "routes/users.ts",
      /deleteS3Prefix\(\s*TOPO_BUCKET,\s*`exports\//,
    ],
    inputs: ["lib/topoUpload.ts", /\[\s*`inputs\/\$\{jobId\}\/`,/],
    outputs: ["lib/topoUpload.ts", /`outputs\/\$\{jobId\}\/`,/],
    jobs: ["lib/topoUpload.ts", /`jobs\/\$\{jobId\}\/`,?\s*\]/],
  };

  it("declares the head of every key the API builds", () => {
    expect(heads.size, "the scan found too few key literals").toBeGreaterThan(
      4,
    );
    const undeclared = [...heads.keys()].filter(
      (head) => !(USER_DATA_S3_HEADS as readonly string[]).includes(head),
    );
    expect(
      undeclared,
      "a new S3 prefix holds user data: add it to USER_DATA_S3_HEADS " +
        "(lib/s3AccessLog.ts), teach attributeKey to charge its egress, and " +
        "delete it in the account purge (routes/users.ts)",
    ).toEqual([]);
  });

  it("charges each declared head's egress to someone", () => {
    const unattributed = USER_DATA_S3_HEADS.filter(
      (head) => attributeKey(`${head}/id/object`) === null,
    );
    expect(
      unattributed,
      "make attributeKey (lib/s3AccessLog.ts) switch on the head",
    ).toEqual([]);
  });

  it("deletes each declared head in the purge", () => {
    expect(Object.keys(PURGED_BY).sort()).toEqual(
      [...USER_DATA_S3_HEADS].sort(),
    );
    const missing = USER_DATA_S3_HEADS.filter((head) => {
      const [file, pattern] = PURGED_BY[head];
      return !pattern.test(readFileSync(join(SRC, file), "utf8"));
    });
    expect(
      missing,
      "the account purge (routes/users.ts, or deleteTopoJobObjects in " +
        "lib/topoUpload.ts) must delete this prefix: a cascade never deletes S3 objects",
    ).toEqual([]);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import pg from "pg";
import { databaseUrlFromEnv } from "../lib/databaseUrl";
import prisma from "../services/prisma";
import { errorHandler } from "../middleware/errorHandler";
import { ROUTER_MOUNTS } from "../routes/mounts";
import {
  as,
  ALICE_SUB,
  ALICE_ID,
  BOB_ID,
  BOB_SHARED_PLACE_ID,
  BOB_SHARED_ROUTE_ID,
  BOB_SHARED_TOPO_JOB_ID,
  SHARED_PLACE_ID,
} from "./_actors";

// Every GET runs in this process, so the SQL Prisma sends for it can be
// captured and EXPLAINed. Under enable_seqscan = off the planner reads a whole
// table only when no index fits the query, so a missing index shows on the
// suite's small seed as well as on a big table. Every table is guarded: a read
// path that must scan one whole is the thing to fix. Mutation: drop
// notifications_user_id_idx and GET /notifications turns red.

const app = express().use(express.json());
for (const [path, router] of ROUTER_MOUNTS) app.use(path, router);
app.use(errorHandler);

// Each GET route, by its template, and the requests that exercise it as
// alice; a `:name` in a request is a seeded id looked up in beforeAll.
const READ_PATHS: Record<string, [string, ...string[]]> = {
  "/users/me": ["/users/me"],
  "/place-types": ["/place-types"],
  "/places": ["/places"],
  "/places/shared": ["/places/shared"],
  "/places/tracks": ["/places/tracks"],
  "/places/:id": [
    `/places/${SHARED_PLACE_ID}`,
    `/places/${BOB_SHARED_PLACE_ID}`,
  ],
  "/places/:placeId/trips": [`/places/${SHARED_PLACE_ID}/trips`],
  "/places/:id/shares": [`/places/${SHARED_PLACE_ID}/shares`],
  "/trips": ["/trips"],
  "/trips/:id": ["/trips/:trip"],
  "/routes": ["/routes"],
  "/routes/:id": [`/routes/${BOB_SHARED_ROUTE_ID}`],
  "/shares/:entityType/:entityId": ["/shares/:share"],
  "/custom-fields/:entity": ["/custom-fields/place"],
  "/custom-fields/:entity/:key/impact": ["/custom-fields/place/:defKey/impact"],
  "/file-sends/sent": ["/file-sends/sent"],
  "/topo-exports": ["/topo-exports"],
  "/topo-exports/:id": ["/topo-exports/:export"],
  "/media/standalone": ["/media/standalone"],
  "/notifications": ["/notifications"],
  "/notifications/unread-count": ["/notifications/unread-count"],
  "/friends": ["/friends"],
  "/friends/requests": ["/friends/requests"],
  "/friends/:id/shares": ["/friends/:friendship/shares"],
  "/friends/invites": ["/friends/invites"],
  "/topo-jobs": ["/topo-jobs"],
  "/topo-jobs/completed-overlays": ["/topo-jobs/completed-overlays"],
  "/topo-jobs/:id": [`/topo-jobs/${BOB_SHARED_TOPO_JOB_ID}`],
  "/sync/delta": ["/sync/delta"],
};

// The GETs not EXPLAINed, and why. On the seed's few rows the planner drives
// the last two from the wrong side, where real tables start from the caller's
// own rows; no index is missing.
const LEFT_OUT: Record<string, string> = {
  "/meta": "server constants; no database",
  "/meta/min-mobile-version": "server constants; no database",
  "/vector-style": "reads only the caller's user row, as every GET does",
  "/users/me/export": "the full export reads every table by design",
  "/friends/search": "a substring match reads every username by design",
  "/file-sends/inbox": "on the seed, driven from all file_sends",
  "/friends/leaderboard": "on the seed, driven from every Canyon place",
};

type Captured = { text: string; values?: unknown[] };
let captured: Captured[] | null = null;
const query = pg.Client.prototype.query;
(pg.Client.prototype as any).query = function (
  config: any,
  values: any,
  ...rest: any[]
) {
  if (captured) {
    const text = typeof config === "string" ? config : config?.text;
    const params = Array.isArray(values) ? values : config?.values;
    if (typeof text === "string" && /^\s*(select|with)\b/i.test(text)) {
      captured.push({ text, values: params });
    }
  }
  return (query as any).call(this, config, values, ...rest);
};

const explainer = new pg.Client({ connectionString: databaseUrlFromEnv() });
const seededIds: Record<string, string> = {};
beforeAll(async () => {
  await explainer.connect();
  // A fresh cluster plans an unanalyzed table as at least ten pages until
  // autovacuum first reaches it, so a plan could flip partway through CI.
  await explainer.query("ANALYZE");
  const [friendship, trip, share, def, exportJob] = await Promise.all([
    prisma.friendship.findFirstOrThrow({
      where: {
        requesterId: { in: [ALICE_ID, BOB_ID] },
        addresseeId: { in: [ALICE_ID, BOB_ID] },
      },
    }),
    prisma.tripLog.findFirstOrThrow({ where: { userId: ALICE_ID } }),
    prisma.share.findFirstOrThrow({ where: { sharedById: ALICE_ID } }),
    prisma.customFieldDef.findFirstOrThrow({
      where: { ownerId: ALICE_ID, entity: "place" },
    }),
    // Completed: only a finished export reaches the egress-quota read.
    prisma.topoExportJob.findFirstOrThrow({
      where: { userId: ALICE_ID, status: "completed" },
    }),
  ]);
  seededIds[":friendship"] = friendship.id;
  seededIds[":trip"] = trip.id;
  seededIds[":share"] = `${share.entityType}/${share.entityId}`;
  seededIds[":defKey"] = def.key;
  seededIds[":export"] = exportJob.id;
});
afterAll(async () => {
  pg.Client.prototype.query = query;
  await explainer.end();
});

type PlanNode = {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Index Cond"?: string;
  Plans?: PlanNode[];
};

/** Every node that reads a whole table: a sequential scan, or an index scan
 *  with no condition, which the planner picks instead once seqscan is off.
 *  An index scan whose only condition is on a later column of a composite
 *  index reads it whole too, and is not caught. */
function fullScans(node: PlanNode, out: string[] = []): string[] {
  const type = node["Node Type"];
  if (type === "Seq Scan") out.push(`Seq Scan on ${node["Relation Name"]}`);
  if (
    (type === "Index Scan" || type === "Index Only Scan") &&
    !node["Index Cond"]
  ) {
    out.push(`full ${type} of ${node["Index Name"]}`);
  }
  for (const child of node.Plans ?? []) fullScans(child, out);
  return out;
}

async function explain(q: Captured): Promise<string[]> {
  await explainer.query("BEGIN");
  try {
    // With hash and merge joins off too, every join is a nested loop whose
    // inner side has an index condition only if an index fits the join key;
    // otherwise a tiny seed table joins through a full scan that a big one
    // would not.
    await explainer.query(
      "SET LOCAL enable_seqscan = off; SET LOCAL enable_hashjoin = off; SET LOCAL enable_mergejoin = off",
    );
    const { rows } = await explainer.query(
      `EXPLAIN (FORMAT JSON) ${q.text}`,
      q.values,
    );
    return fullScans(rows[0]["QUERY PLAN"][0].Plan);
  } finally {
    await explainer.query("ROLLBACK");
  }
}

describe("key read paths use an index", () => {
  const requests = Object.values(READ_PATHS).flat();
  it.each(requests)("GET %s", async (path) => {
    captured = [];
    const res = await request(app)
      .get(path.replace(/:\w+/g, (key) => seededIds[key]))
      .set(as(ALICE_SUB))
      .set("x-logjam-client", "mobile/0.1.0-test");
    const queries = captured;
    captured = null;
    expect(res.status).toBe(200);
    expect(queries.length).toBeGreaterThan(0);

    const problems: string[] = [];
    for (const q of queries) {
      for (const scan of await explain(q)) {
        problems.push(`${scan}\n  ${q.text.slice(0, 300)}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

// Reads the router.get routes of ROUTER_MOUNTS; /health and /ready sit in
// index.ts and read no table. Mutation: add a router.get, or rename one.
it("every router GET is EXPLAINed or left out for a reason", () => {
  type Layer = { route?: { path: string; methods: Record<string, boolean> } };
  const routes = ROUTER_MOUNTS.flatMap(([mount, router]) =>
    (router as unknown as { stack: Layer[] }).stack
      .filter((layer) => layer.route?.methods.get)
      .map(
        (layer) => mount + (layer.route!.path === "/" ? "" : layer.route!.path),
      ),
  );
  const declared = [...Object.keys(READ_PATHS), ...Object.keys(LEFT_OUT)];
  expect(routes.filter((route) => !declared.includes(route))).toEqual([]);
  expect(declared.filter((route) => !routes.includes(route))).toEqual([]);
  expect(Object.keys(READ_PATHS).filter((route) => route in LEFT_OUT)).toEqual(
    [],
  );
});

// An unindexed foreign key makes every join on it, and every cascade from its
// parent, read the whole child table. Mutation: drop shares_shared_by_id_idx.
it("every foreign key leads an index", async () => {
  const { rows } = await explainer.query(`
    SELECT c.conrelid::regclass::text AS "table", a.attname AS "column"
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_index i
                        WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]
                          AND i.indisvalid AND i.indpred IS NULL)`);
  expect(rows).toEqual([]);
});

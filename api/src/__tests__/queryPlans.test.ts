import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import pg from "pg";
import { databaseUrlFromEnv } from "../lib/databaseUrl";
import prisma from "../services/prisma";
import { errorHandler } from "../middleware/errorHandler";
import placesRouter from "../routes/places";
import tripLogsGlobalRouter from "../routes/tripLogsGlobal";
import routesRouter from "../routes/routes";
import mediaRouter from "../routes/media";
import notificationsRouter from "../routes/notifications";
import friendsRouter from "../routes/friends";
import topoJobsRouter from "../routes/topoJobs";
import placeTypesRouter from "../routes/placeTypes";
import usersRouter from "../routes/users";
import syncRouter from "../routes/sync";
import sharingRouter from "../routes/sharing";
import fileSendsRouter from "../routes/fileSends";
import customFieldsRouter from "../routes/customFields";
import topoExportsRouter from "../routes/topoExports";
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

// The key read paths run in this process, so the SQL Prisma sends for them can
// be captured and EXPLAINed. Under enable_seqscan = off the planner reads a
// whole table only when no index fits the query, so a missing index shows on
// the suite's small seed as well as on a big table. Every table is guarded: a
// read path that must scan one whole is the thing to fix. The paths are the
// GETs Logjam Web and Logjam GPS call on load, on the map and in sync. Left
// out: the full export and /friends/search (a substring match on usernames)
// read whole tables by design. On the seed's few rows the planner drives
// /file-sends/inbox from file_sends and /friends/leaderboard's canyon count
// from every Canyon place, reading the other side whole, where real tables
// start from the caller's own rows; no index is missing.
// Mutation: drop notifications_user_id_idx and GET /notifications turns red.

const app = express()
  .use(express.json())
  .use("/users", usersRouter)
  .use("/place-types", placeTypesRouter)
  .use("/places", placesRouter)
  .use("/places", sharingRouter)
  .use("/custom-fields", customFieldsRouter)
  .use("/file-sends", fileSendsRouter)
  .use("/topo-exports", topoExportsRouter)
  .use("/trips", tripLogsGlobalRouter)
  .use("/routes", routesRouter)
  .use("/media", mediaRouter)
  .use("/notifications", notificationsRouter)
  .use("/friends", friendsRouter)
  .use("/topo-jobs", topoJobsRouter)
  .use("/sync", syncRouter)
  .use(errorHandler);

const READ_PATHS = [
  "/users/me",
  "/place-types",
  "/places",
  "/places/shared",
  `/places/${SHARED_PLACE_ID}`,
  `/places/${BOB_SHARED_PLACE_ID}`,
  "/trips",
  "/trips/:trip",
  `/routes/${BOB_SHARED_ROUTE_ID}`,
  `/places/${SHARED_PLACE_ID}/shares`,
  "/custom-fields/place",
  "/file-sends/sent",
  "/topo-exports",
  "/media/standalone",
  "/notifications",
  "/notifications/unread-count",
  "/friends",
  "/friends/requests",
  "/friends/:friendship/shares",
  "/topo-jobs",
  "/topo-jobs/completed-overlays",
  `/topo-jobs/${BOB_SHARED_TOPO_JOB_ID}`,
  "/sync/delta",
];

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
  const [friendship, trip] = await Promise.all([
    prisma.friendship.findFirstOrThrow({
      where: {
        requesterId: { in: [ALICE_ID, BOB_ID] },
        addresseeId: { in: [ALICE_ID, BOB_ID] },
      },
    }),
    prisma.tripLog.findFirstOrThrow({ where: { userId: ALICE_ID } }),
  ]);
  seededIds[":friendship"] = friendship.id;
  seededIds[":trip"] = trip.id;
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
  it.each(READ_PATHS)("GET %s", async (path) => {
    captured = [];
    const res = await request(app)
      .get(path.replace(/:\w+/, (key) => seededIds[key]))
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

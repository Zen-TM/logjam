// Puts the database back as the seed left it after every integration file, and
// fails the file that touched a seeded row.
//
// WHY a sweep and not per-test tracking: a test that forgets to record what it
// created leaks it, and a failed test never reaches its own cleanup, which is
// how a mutation run poisoned the next run (#278). A sweep needs no
// cooperation, covers every table the schema has today or gains later (the
// table list and primary keys come from Postgres, not a list here), and
// still runs when a test throws.
//
// Contract: a test should create what it needs and leave seeded rows alone.
// Existing tests do change seeded rows (revoking a seeded share, patching
// alice), so the sweep also writes any drifted seeded row back to its seeded
// value, and the check after it fails the file if the database still differs
// from the baseline anywhere, naming the table: a sweep that missed a table
// or kind of row is red, not silent.
//
// Not covered: S3 objects in MiniStack (media, sends, GeoPDFs, topo outputs)
// and ECS tasks. They are orphaned by the row sweep and harmless to a rerun,
// since nothing lists a bucket; MiniStack's volume is wiped by `make reset`.

import defaultPrisma from "../services/prisma";

/** The seed passes its own client; the suite uses the app's. */
type Db = Pick<typeof defaultPrisma, "$queryRawUnsafe" | "$executeRawUnsafe">;
const prisma = defaultPrisma;

/** table -> (row key -> the whole row as jsonb text). */
export type Snapshot = Record<string, Record<string, string>>;

export interface Drift {
  table: string;
  key: string;
  kind: "modified" | "deleted" | "extra";
}

interface TableDef {
  table: string;
  /** SQL expression yielding one text key per row. */
  keyExpr: string;
}

async function tables(db: Db = prisma): Promise<TableDef[]> {
  const rows = await db.$queryRawUnsafe<
    { table: string; pk: string[] | null }[]
  >(`
    SELECT c.relname AS "table",
           (SELECT array_agg(a.attname::text ORDER BY k.ord)
              FROM pg_index i
              CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
             WHERE i.indrelid = c.oid AND i.indisprimary) AS pk
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname <> '_prisma_migrations'
     ORDER BY c.relname`);
  return rows.map(({ table, pk }) => ({
    table,
    // A table with no primary key is keyed by its whole row: extras are still
    // found and swept, a modified row just reads as one deleted and one extra.
    keyExpr: pk
      ? `concat_ws('|', ${pk.map((c) => `t."${c}"::text`).join(", ")})`
      : "md5(t::text)",
  }));
}

export async function takeSnapshot(db: Db = prisma): Promise<Snapshot> {
  const snap: Snapshot = {};
  for (const { table, keyExpr } of await tables(db)) {
    const rows = await db.$queryRawUnsafe<{ k: string; h: string }[]>(
      `SELECT ${keyExpr} AS k, to_jsonb(t)::text AS h FROM "${table}" t`,
    );
    snap[table] = Object.fromEntries(rows.map((r) => [r.k, r.h]));
  }
  return snap;
}

// The seed's own state, written by `prisma db seed` after it finishes. It lives
// in the database it describes, in a schema Prisma and `tables()` never see,
// so it is there wherever the seed ran (laptop, kiosk, CI) and can never be
// read against a different database than it was taken from. A list of seeded
// ids would need a hand edit with every new kind of seeded data; this does not.
const SEED_SCHEMA = "logjam_seed";

export async function saveSeedSnapshot(db: Db): Promise<void> {
  const snap = await takeSnapshot(db);
  await db.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${SEED_SCHEMA}`);
  await db.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS ${SEED_SCHEMA}.snapshot (data jsonb NOT NULL)`,
  );
  await db.$executeRawUnsafe(`DELETE FROM ${SEED_SCHEMA}.snapshot`);
  await db.$executeRawUnsafe(
    `INSERT INTO ${SEED_SCHEMA}.snapshot (data) VALUES ($1::jsonb)`,
    JSON.stringify(snap),
  );
}

/** null when no seed has recorded one (a database seeded before this existed). */
export async function loadSeedSnapshot(
  db: Db = prisma,
): Promise<Snapshot | null> {
  const rows = await db
    .$queryRawUnsafe<{ data: Snapshot }[]>(
      `SELECT data FROM ${SEED_SCHEMA}.snapshot LIMIT 1`,
    )
    .catch(() => []);
  return rows[0]?.data ?? null;
}

/** Pure: every difference between the seed and the live database, either way. */
export function seedMismatch(seed: Snapshot, live: Snapshot): Drift[] {
  return [...seededDrift(seed, live), ...extraRows(seed, live)];
}

/** Pure: what a run that starts off the seed refuses with. */
export function describeSeedMismatch(seed: Snapshot | null, live: Snapshot) {
  const fix =
    "Put the database back with `make seed` (it wipes the dev database and " +
    "re-seeds it, so local data you want to keep must be exported first).";
  if (!seed)
    return `No seed snapshot in this database. It was seeded before the suite checked for one. ${fix}`;
  const diff = seedMismatch(seed, live);
  if (!diff.length) return null;
  return (
    `The database is not as the seed left it (${diff.length} row(s)): a ` +
    "run killed before its cleanup, or local use of the app, leaves rows " +
    `the suite would adopt as seed.\n${describeDrift(diff)}\n${fix}`
  );
}

/** Pure: what changed or vanished among the baseline rows. Extras are not
 *  drift here; the sweep removes them and `extraRows` checks it did. */
export function seededDrift(base: Snapshot, now: Snapshot): Drift[] {
  const out: Drift[] = [];
  for (const [table, rows] of Object.entries(base)) {
    for (const [key, hash] of Object.entries(rows)) {
      const current = now[table]?.[key];
      if (current === undefined) out.push({ table, key, kind: "deleted" });
      else if (current !== hash) out.push({ table, key, kind: "modified" });
    }
  }
  return out;
}

/** Delete every row absent from the baseline. Foreign keys make the order
 *  matter and the schema does not say it, so retry the refused tables until a
 *  pass deletes nothing more. */
export async function sweepToBaseline(base: Snapshot): Promise<void> {
  const defs = await tables();
  let pending = defs;
  for (let pass = 0; pass < defs.length + 1 && pending.length; pass++) {
    const refused: TableDef[] = [];
    let progressed = false;
    for (const def of pending) {
      const known = Object.keys(base[def.table] ?? {});
      try {
        const n = await prisma.$executeRawUnsafe(
          `DELETE FROM "${def.table}" t WHERE NOT (${def.keyExpr} = ANY($1::text[]))`,
          known,
        );
        if (n > 0) progressed = true;
      } catch {
        refused.push(def);
      }
    }
    if (!progressed && refused.length === pending.length) break;
    pending = refused;
  }
}

/** Pure: rows present now that the baseline lacks. */
export function extraRows(base: Snapshot, now: Snapshot): Drift[] {
  const out: Drift[] = [];
  for (const [table, rows] of Object.entries(now)) {
    for (const key of Object.keys(rows)) {
      if (base[table]?.[key] === undefined)
        out.push({ table, key, kind: "extra" });
    }
  }
  return out;
}

/** Write drifted seeded rows back to their seeded values. Deleted rows are
 *  re-inserted, retrying refused tables since foreign keys fix the order. */
export async function restoreSeeded(
  base: Snapshot,
  drift: Drift[],
): Promise<void> {
  const defs = new Map((await tables()).map((d) => [d.table, d]));
  let pending = drift;
  while (pending.length) {
    const refused: Drift[] = [];
    for (const d of pending) {
      const def = defs.get(d.table)!;
      const row = base[d.table][d.key];
      try {
        if (d.kind === "deleted") {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "${d.table}" SELECT (jsonb_populate_record(null::"${d.table}", $1::jsonb)).*`,
            row,
          );
        } else {
          const cols = Object.keys(JSON.parse(row) as object);
          await prisma.$executeRawUnsafe(
            `UPDATE "${d.table}" t SET ${cols.map((c) => `"${c}" = r."${c}"`).join(", ")}
               FROM jsonb_populate_record(null::"${d.table}", $1::jsonb) r
              WHERE ${def.keyExpr} = $2`,
            row,
            d.key,
          );
        }
      } catch {
        refused.push(d);
      }
    }
    if (refused.length === pending.length) return; // the check will name them
    pending = refused;
  }
}

export function describeDrift(drift: Drift[]): string {
  return drift
    .map((d) => `  ${d.table} ${d.kind}: ${d.key}`)
    .slice(0, 20)
    .join("\n");
}

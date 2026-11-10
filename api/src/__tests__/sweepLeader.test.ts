import {
  afterEach,
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Client } from "pg";
import { dbConnectionConfig } from "../lib/dbConnection";
import { createSweepLeader, newLockClient } from "../lib/sweepLeader";

// Two sweepers on one real database. Mutations that turn this file red (each
// applied once):
//  - newLockClient returns a wrapper over one shared pooled connection:
//    "exactly one of two sweepers runs".
//  - runIfLeader ignores the lock's result: same test.
//  - `lose` does not clear `holder` in sweepLeader.ts: "a killed holder stops
//    running ticks".
//
// Each test takes its own key, so a slot's API (which sweeps on the real key)
// never interferes.

let key = 0;
let admin: Client;
const leaders: ReturnType<typeof createSweepLeader>[] = [];

beforeAll(async () => {
  admin = new Client(dbConnectionConfig());
  await admin.connect();
});
afterAll(() => admin.end());

afterEach(async () => {
  await Promise.all(leaders.splice(0).map((l) => l.stop()));
});

function sweeper() {
  key = 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
  return key;
}

function newLeader(k: number) {
  const l = createSweepLeader(newLockClient, k);
  leaders.push(l);
  return l;
}

async function holderPids(k: number): Promise<number[]> {
  const { rows } = await admin.query(
    "SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = $1 AND granted",
    [k],
  );
  return rows.map((r) => r.pid);
}

describe("sweep leader on a real database", () => {
  it("exactly one of two sweepers runs; the other runs once the holder stops", async () => {
    const k = sweeper();
    const a = newLeader(k);
    const b = newLeader(k);
    const ranA = vi.fn();
    const ranB = vi.fn();

    await a.runIfLeader(ranA);
    await b.runIfLeader(ranB);
    await a.runIfLeader(ranA);
    await b.runIfLeader(ranB);
    expect(ranA).toHaveBeenCalledTimes(2);
    expect(ranB).not.toHaveBeenCalled();
    expect(await holderPids(k)).toHaveLength(1);

    await a.stop();
    expect(await holderPids(k)).toHaveLength(0);
    await b.runIfLeader(ranB);
    expect(ranB).toHaveBeenCalledTimes(1);
    expect(await holderPids(k)).toHaveLength(1);
  });

  it("a holder whose connection is killed stops running ticks and the other takes over", async () => {
    const k = sweeper();
    const a = newLeader(k);
    const b = newLeader(k);
    const ranA = vi.fn();
    const ranB = vi.fn();
    await a.runIfLeader(ranA);
    await b.runIfLeader(ranB);
    expect(ranB).not.toHaveBeenCalled();

    const [pid] = await holderPids(k);
    await admin.query("SELECT pg_terminate_backend($1)", [pid]);
    // Postgres frees the lock at once; the client learns of it asynchronously.
    await vi.waitFor(async () => expect(await holderPids(k)).toHaveLength(0));

    // The second sweeper tries first, so it wins before the old holder can
    // retry; the old holder is then locked out, not still running.
    await b.runIfLeader(ranB);
    await a.runIfLeader(ranA);
    expect(ranB).toHaveBeenCalledTimes(1);
    expect(ranA).toHaveBeenCalledTimes(1);
    expect(await holderPids(k)).toHaveLength(1);
  });

  it("a lone holder whose connection is killed takes the lock again on its next tick", async () => {
    const k = sweeper();
    const a = newLeader(k);
    const ran = vi.fn();
    await a.runIfLeader(ran);
    const [pid] = await holderPids(k);
    await admin.query("SELECT pg_terminate_backend($1)", [pid]);
    await vi.waitFor(async () => expect(await holderPids(k)).toHaveLength(0));
    // The client hears of the drop a moment after Postgres frees the lock.
    await vi.waitFor(async () => {
      await a.runIfLeader(ran);
      expect(await holderPids(k)).toHaveLength(1);
    });
  });
});

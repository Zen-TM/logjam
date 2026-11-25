import { Client } from "pg";
import { dbConnectionConfig } from "./dbConnection";
import { logger, safeErrorForLog } from "./logger";

// Names the lock that makes one API process per database the sweeper (see
// startTopoJobReaper). Advisory lock keys are per database, which is the
// scope wanted. The number only has to be unique among this app's own keys
// (it is the only one); it spells "LJSW".
export const SWEEP_LOCK_KEY = 0x4c4a5357;

/** The slice of `pg.Client` the leader uses; tests pass a fake. */
export interface LockClient {
  connect(): Promise<unknown>;
  query(
    sql: string,
    params: unknown[],
  ): Promise<{ rows: { locked: boolean }[] }>;
  end(): Promise<void>;
  on(event: "error" | "end", listener: (err?: Error) => void): unknown;
}

// A session-level lock belongs to its connection, so it needs a client of
// its own: on a pooled connection it would be handed to the next borrower and
// never released. This costs each sweeping process one more Postgres
// connection (the brain's Postgres allows 50).
//
// query_timeout is here and not in dbConnectionConfig() because only this
// client sits idle until a tick pings it: a connection that died without a
// FIN would otherwise stall the ping for the kernel's TCP limit (~15 min), and
// the Prisma pool must not cap slow queries. Guard: lib/sweepLeader.unit.test.ts
// ("builds the lock client from dbConnectionConfig() plus a query timeout").
export function newLockClient(): LockClient {
  return new Client({ ...dbConnectionConfig(), query_timeout: 15_000 });
}

export interface SweepLeader {
  /** Runs `tick` if this process holds (or can now take) the lock. */
  runIfLeader(tick: () => void | Promise<void>): Promise<boolean>;
  /** Closes the lock connection, which releases the lock at once. */
  stop(): Promise<void>;
}

export function createSweepLeader(
  makeClient: () => LockClient = newLockClient,
  key: number = SWEEP_LOCK_KEY,
): SweepLeader {
  let holder: LockClient | null = null;
  let acquiring: Promise<boolean> | null = null;
  let stopped = false;
  let outageLogged = false;

  const close = (client: LockClient) => {
    client.end().catch(() => {});
  };

  // Postgres has already released the lock of a dead session; forget it so the
  // next tick tries again and another process may have taken over meanwhile.
  const lose = (client: LockClient) => {
    if (holder === client) holder = null;
    close(client);
  };

  const acquire = async (): Promise<boolean> => {
    const client = makeClient();
    // Before connect: an idle pg client with no 'error' listener crashes the
    // process when its connection drops.
    client.on("error", () => lose(client));
    client.on("end", () => lose(client));
    try {
      await client.connect();
      const { rows } = await client.query(
        "SELECT pg_try_advisory_lock($1) AS locked",
        [String(key)],
      );
      outageLogged = false;
      if (rows[0]?.locked !== true || stopped) {
        close(client);
        return false;
      }
      holder = client;
      logger.info("sweep_leader_acquired");
      return true;
    } catch (err) {
      close(client);
      if (!outageLogged) {
        outageLogged = true;
        logger.warn({ err: safeErrorForLog(err) }, "sweep_lock_unavailable");
      }
      return false;
    }
  };

  return {
    async runIfLeader(tick) {
      if (stopped) return false;
      // Prove the session is alive before every tick: the server may have
      // ended it, and freed the lock for another process, before the client's
      // 'error'/'end' event arrives. A dead holder is dropped and falls
      // through to a fresh try; its old session is gone, so nothing stacks.
      // On an otherwise idle connection the query also keeps a proxy or
      // firewall from dropping it as idle.
      if (holder) {
        const client = holder;
        try {
          await client.query("SELECT 1", []);
        } catch {
          lose(client);
        }
      }
      if (!holder) {
        // One attempt at a time: two overlapping ticks must not take the lock
        // twice on separate sessions, nor stack it on one.
        acquiring ??= acquire().finally(() => {
          acquiring = null;
        });
        if (!(await acquiring)) {
          logger.debug("sweep_skipped_not_leader");
          return false;
        }
      }
      await tick();
      return true;
    },
    async stop() {
      stopped = true;
      await acquiring?.catch(() => {});
      const client = holder;
      holder = null;
      await client?.end().catch(() => {});
    },
  };
}

import { describe, it, expect, vi } from "vitest";

const { clientConfigs, connConfig } = vi.hoisted(() => ({
  clientConfigs: [] as unknown[],
  connConfig: { host: "x", keepAlive: true, password: () => "p" },
}));
vi.mock("pg", () => ({
  Client: class {
    constructor(config: unknown) {
      clientConfigs.push(config);
    }
  },
}));
vi.mock("./dbConnection", () => ({ dbConnectionConfig: () => connConfig }));

import { logger } from "./logger";
import {
  createSweepLeader,
  newLockClient,
  type LockClient,
} from "./sweepLeader";

// Mutations that turn this file red (each applied once, see the PR):
//  - runIfLeader ignores `rows[0].locked`: "skips while the lock is taken".
//  - `lose` does not clear `holder`: "drops leadership on a connection error".
//  - the `SELECT 1` ping before a held tick is removed: "runs the tick when the
//    ping succeeds and not when it fails".
//  - acquire runs on every call rather than only when not holding: "does not
//    stack".
//  - newLockClient builds `new Client({ host })` (prod's TLS and
//    password callback lost, so the lock is never taken in prod): "builds the
//    lock client from dbConnectionConfig() plus a query timeout".
//  - `query_timeout` dropped from newLockClient: the same test.
//  - the `if (!outageLogged)` guard removed, or `outageLogged` never reset
//    on a successful acquire: "warns once per outage".
//  - the `client.on("end", ...)` listener removed: "drops leadership when the
//    connection ends".

class FakeClient implements LockClient {
  static taken = false; // the "server": one session at a time may hold it
  holds = false;
  queries = 0;
  ended = 0;
  listeners: Record<string, (err?: Error) => void> = {};
  failConnect = false;
  async connect() {
    if (this.failConnect) throw new Error("connect refused");
  }
  pingFails = false;
  async query(sql: string) {
    if (sql === "SELECT 1") {
      if (this.pingFails) throw new Error("connection terminated");
      return { rows: [] };
    }
    this.queries++;
    const locked = !FakeClient.taken;
    if (locked) {
      FakeClient.taken = true;
      this.holds = true;
    }
    return { rows: [{ locked }] };
  }
  async end() {
    this.ended++;
    if (this.holds) {
      this.holds = false;
      FakeClient.taken = false;
    }
  }
  on(event: "error" | "end", listener: (err?: Error) => void) {
    this.listeners[event] = listener;
    return this;
  }
  // The server dropped the session: Postgres releases the lock itself.
  kill(event: "error" | "end" = "error") {
    if (this.holds) FakeClient.taken = false;
    this.holds = false;
    this.listeners[event]?.(new Error("terminated"));
  }
}

function setup() {
  FakeClient.taken = false;
  const clients: FakeClient[] = [];
  const leader = createSweepLeader(() => {
    const c = new FakeClient();
    clients.push(c);
    return c;
  });
  return { leader, clients };
}

describe("sweep leader", () => {
  it("takes the lock once and runs every tick after without asking again", async () => {
    const { leader, clients } = setup();
    const tick = vi.fn();
    await leader.runIfLeader(tick);
    await leader.runIfLeader(tick);
    await leader.runIfLeader(tick);
    expect(tick).toHaveBeenCalledTimes(3);
    expect(clients).toHaveLength(1);
    expect(clients[0].queries).toBe(1);
  });

  it("runs the tick when the ping succeeds and not when it fails", async () => {
    const { leader, clients } = setup();
    const tick = vi.fn();
    await leader.runIfLeader(tick);
    await leader.runIfLeader(tick);
    expect(tick).toHaveBeenCalledTimes(2);

    // No 'error' event: only the ping can tell. The server's lock is gone and
    // another process has it.
    clients[0].pingFails = true;
    clients[0].holds = false;
    FakeClient.taken = true;
    expect(await leader.runIfLeader(tick)).toBe(false);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(clients[0].ended).toBe(1);
    // Leadership was cleared, so the next tick tries to acquire afresh.
    FakeClient.taken = false;
    expect(await leader.runIfLeader(tick)).toBe(true);
    expect(clients).toHaveLength(3);
  });

  it("does not stack when ticks overlap while acquiring", async () => {
    const { leader, clients } = setup();
    const tick = vi.fn();
    await Promise.all([leader.runIfLeader(tick), leader.runIfLeader(tick)]);
    expect(clients).toHaveLength(1);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("skips while the lock is taken, closing its spare connection", async () => {
    FakeClient.taken = true;
    const clients: FakeClient[] = [];
    const leader = createSweepLeader(() => {
      const c = new FakeClient();
      clients.push(c);
      return c;
    });
    const tick = vi.fn();
    expect(await leader.runIfLeader(tick)).toBe(false);
    expect(tick).not.toHaveBeenCalled();
    expect(clients[0].ended).toBe(1);
    // Tries again on the next tick.
    FakeClient.taken = false;
    expect(await leader.runIfLeader(tick)).toBe(true);
  });

  it("drops leadership on a connection error and tries again", async () => {
    const { leader, clients } = setup();
    const tick = vi.fn();
    await leader.runIfLeader(tick);
    clients[0].kill();
    await leader.runIfLeader(tick);
    expect(clients).toHaveLength(2);
    expect(clients[1].holds).toBe(true);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("drops leadership when the connection ends", async () => {
    const { leader, clients } = setup();
    const tick = vi.fn();
    await leader.runIfLeader(tick);
    clients[0].kill("end");
    expect(clients[0].ended).toBe(1);
    await leader.runIfLeader(tick);
    expect(clients).toHaveLength(2);
    expect(clients[1].holds).toBe(true);
  });

  it("warns once per outage", async () => {
    FakeClient.taken = false;
    let fail = true;
    const clients: FakeClient[] = [];
    const leader = createSweepLeader(() => {
      const c = new FakeClient();
      c.failConnect = fail;
      clients.push(c);
      return c;
    });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const tick = vi.fn();
    await leader.runIfLeader(tick);
    await leader.runIfLeader(tick);
    expect(warn).toHaveBeenCalledTimes(1);
    // Recovery re-arms the warning: the next outage is reported once more.
    fail = false;
    expect(await leader.runIfLeader(tick)).toBe(true);
    fail = true;
    (clients.at(-1) as FakeClient).pingFails = true;
    await leader.runIfLeader(tick);
    await leader.runIfLeader(tick);
    expect(warn).toHaveBeenCalledTimes(2);
    await leader.stop();
    warn.mockRestore();
  });

  it("builds the lock client from dbConnectionConfig() plus a query timeout", () => {
    newLockClient();
    expect(clientConfigs).toEqual([{ ...connConfig, query_timeout: 15_000 }]);
  });

  it("skips and recovers when the connection cannot be opened", async () => {
    FakeClient.taken = false;
    let fail = true;
    const leader = createSweepLeader(() => {
      const c = new FakeClient();
      c.failConnect = fail;
      return c;
    });
    const tick = vi.fn();
    expect(await leader.runIfLeader(tick)).toBe(false);
    expect(await leader.runIfLeader(tick)).toBe(false);
    fail = false;
    expect(await leader.runIfLeader(tick)).toBe(true);
  });

  it("releases on stop and runs nothing after", async () => {
    const { leader, clients } = setup();
    const tick = vi.fn();
    await leader.runIfLeader(tick);
    await leader.stop();
    expect(clients[0].ended).toBeGreaterThan(0);
    expect(FakeClient.taken).toBe(false);
    expect(await leader.runIfLeader(tick)).toBe(false);
    expect(tick).toHaveBeenCalledTimes(1);
  });
});

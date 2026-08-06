import { beforeEach, describe, expect, it, vi } from "vitest";

// The offline write path for routes: a route drawn with no signal has to land
// in the mirror (so it draws immediately) AND in the outbox (so it reaches the
// server later). Both halves in one transaction, or the map shows a route that
// will never sync.
//
// getSyncDb reaches for expo-sqlite, which throws outside a native runtime, so
// the DB is a recording stand-in — this asserts the SQL and the op shape, which
// is what actually breaks. Column/placeholder mismatches and a forgotten
// appendOp are exactly the silent failures device testing kept masking behind
// input-timing flakiness.

type Call = { sql: string; args: unknown[] };
const calls: Call[] = [];
let transactionRan = false;

const db = {
  runAsync: (sql: string, ...args: unknown[]) => {
    calls.push({ sql, args });
    return Promise.resolve({ changes: 1, lastInsertRowId: 1 });
  },
  getFirstAsync: () => Promise.resolve(null),
  getAllAsync: () => Promise.resolve([]),
  withTransactionAsync: async (fn: () => Promise<void>) => {
    transactionRan = true;
    await fn();
  },
};

vi.mock("./syncDb", () => ({
  getSyncDb: () => Promise.resolve(db),
  notifyMirrorChanged: () => {},
}));
// scheduleMutationSync lives in mediaSyncBridge, which reaches into
// react-native (Flow syntax vitest can't parse) — stub the module, not the
// engine behind it.
vi.mock("./mediaSyncBridge", () => ({ scheduleMutationSync: () => {} }));
vi.mock("expo-crypto", () => ({
  randomUUID: () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    }),
}));

const { createRouteLocal, deleteRouteLocal } = await import("./outbox");

/** The mirror INSERT/DELETE, and the outbox append, out of the recorded calls. */
function find(fragment: string): Call | undefined {
  return calls.find((call) => call.sql.includes(fragment));
}

describe("createRouteLocal", () => {
  beforeEach(() => {
    calls.length = 0;
    transactionRan = false;
  });

  it("writes the mirror row and the outbox op in ONE transaction", async () => {
    await createRouteLocal({
      name: "Claustral approach",
      points: [
        [150.4033, -33.5603],
        [150.4043, -33.5613],
      ],
    });
    expect(transactionRan).toBe(true);
    expect(find("INSERT INTO routes")).toBeDefined();
    expect(find("INSERT INTO outbox")).toBeDefined();
  });

  it("binds one argument per placeholder in the mirror INSERT", async () => {
    // The failure this guards is silent: a mismatch throws inside the
    // transaction, the row never lands, and the UI still closes the tool.
    await createRouteLocal({ name: "A", points: [[150, -33], [151, -34]] });
    const insert = find("INSERT INTO routes")!;
    const placeholders = (insert.sql.match(/\?/g) ?? []).length;
    expect(insert.args).toHaveLength(placeholders);
  });

  it("stores geometry as JSON text, round-trippable", async () => {
    const points: [number, number][] = [
      [150.4033, -33.5603],
      [150.4043, -33.5613],
      [150.4053, -33.5608],
    ];
    await createRouteLocal({ name: "Round trip", points });
    const insert = find("INSERT INTO routes")!;
    const stored = insert.args.find(
      (arg) => typeof arg === "string" && arg.startsWith("[["),
    );
    expect(JSON.parse(stored as string)).toEqual(points);
  });

  it("queues a route/create op carrying name and points", async () => {
    await createRouteLocal({ name: "Queued", points: [[150, -33], [151, -34]] });
    const op = find("INSERT INTO outbox")!;
    expect(op.args).toContain("route");
    expect(op.args).toContain("create");
    const fields = op.args.find(
      (arg) => typeof arg === "string" && arg.includes("points"),
    );
    expect(JSON.parse(fields as string)).toMatchObject({
      name: "Queued",
      points: [[150, -33], [151, -34]],
    });
  });

  it("omits canyonId from the op when the route is standalone", async () => {
    await createRouteLocal({ name: "Standalone", points: [[150, -33], [151, -34]] });
    const op = find("INSERT INTO outbox")!;
    const fields = op.args.find(
      (arg) => typeof arg === "string" && arg.includes("points"),
    );
    expect(JSON.parse(fields as string)).not.toHaveProperty("canyonId");
  });

  it("carries canyonId through when linking at create time", async () => {
    await createRouteLocal({
      name: "Linked",
      points: [[150, -33], [151, -34]],
      canyonId: "canyon-1",
    });
    const op = find("INSERT INTO outbox")!;
    const fields = op.args.find(
      (arg) => typeof arg === "string" && arg.includes("points"),
    );
    expect(JSON.parse(fields as string)).toMatchObject({ canyonId: "canyon-1" });
  });

  it("returns a client-minted id, so the op needs no remapping on flush", async () => {
    const id = await createRouteLocal({
      name: "Minted",
      points: [[150, -33], [151, -34]],
    });
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(find("INSERT INTO routes")!.args).toContain(id);
  });
});

describe("deleteRouteLocal", () => {
  beforeEach(() => {
    calls.length = 0;
    transactionRan = false;
  });

  it("removes the mirror row and queues the delete together", async () => {
    await deleteRouteLocal("route-1");
    expect(transactionRan).toBe(true);
    expect(find("DELETE FROM routes")).toBeDefined();
    const op = find("INSERT INTO outbox")!;
    expect(op.args).toContain("route");
    expect(op.args).toContain("delete");
  });
});

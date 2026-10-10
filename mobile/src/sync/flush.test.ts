import { beforeEach, describe, expect, it, vi } from "vitest";

import { SYNC_GIVE_UP_AFTER_MS } from "@logjam/shared";

import { markNoResponse, markTransferCut } from "../api/noResponse";

// Two head-of-line failures the flush engine used to have, both invisible to
// the rest of the suite because they only appear when an op FAILS:
//
//  - one unreadable photo aborted the whole media pass, every pass, so every
//    other upload on the device was blocked forever by an op that never parked
//    and so never appeared in Sync Issues either;
//  - one structurally-bad op made the server refuse the ENVELOPE (400), which
//    parked all fifty ops in the batch as fifty separate sync issues, telling
//    the user the server rejected forty-nine edits it never saw.
//
// The database is a recording stand-in (expo-sqlite has no native runtime
// here); what matters is which rows end in which state.

type Row = {
  seq: number;
  op_id: string;
  entity: string;
  op: string;
  entity_id: string;
  base_updated_at: string | null;
  fields_json: string | null;
  base_fields_json: string | null;
  state: string;
  media_phase: string | null;
  error_json: string | null;
  attempts: number;
};

let rows: Row[] = [];
/** Op ids the fake server refuses at the envelope level (one bad op → 400). */
let poison = new Set<string>();
let pushCalls: string[][] = [];
/** Miscount the fake server applies to its results array (+1 = one extra
 * result, -1 = one missing). MSD-005. */
let resultCountDelta = 0;
/** Media ops whose runner throws (a file the OS reclaimed). */
let deadMedia = new Set<number>();
/** Media ops whose runner throws this instead, by seq. */
let mediaErrors = new Map<number, unknown>();
/** What the fake server does to the whole push request instead of answering. */
let envelopeError: unknown = null;
/** Per-op results the fake server answers with instead of `applied`, by opId. */
let answers = new Map<string, Record<string, unknown>>();
/** Rows written to the conflict shelf. */
let shelved: unknown[][] = [];
/** Per-op rejections the fake server answers with, by opId. */
let rejections = new Map<string, { code: number; message: string }>();
let mediaRuns: number[] = [];

function mediaRow(seq: number, extra: Partial<Row> = {}): Row {
  return {
    seq,
    op_id: `op-${seq}`,
    entity: "media",
    op: "create",
    entity_id: `media-${seq}`,
    base_updated_at: null,
    fields_json: JSON.stringify({ linkedType: "place", linkedId: `c-${seq}` }),
    base_fields_json: null,
    state: "queued",
    media_phase: null,
    error_json: null,
    attempts: 0,
    ...extra,
  };
}

function pushRow(seq: number): Row {
  return {
    seq,
    op_id: `op-${seq}`,
    entity: "waypoint",
    op: "update",
    entity_id: `wp-${seq}`,
    base_updated_at: null,
    fields_json: JSON.stringify({ name: "n" }),
    base_fields_json: null,
    state: "queued",
    media_phase: null,
    error_json: null,
    attempts: 0,
  };
}

/** Minimal SQL interpreter over `rows` — only the statements flush.ts issues. */
function run(sql: string, args: unknown[]): void {
  const seqIn = sql.match(/seq IN \(([^)]*)\)/);
  const targets = seqIn
    ? args.slice(-(seqIn[1].match(/\?/g) ?? []).length)
    : sql.includes("WHERE seq = ?")
      ? [args[args.length - 1]]
      : rows.map((row) => row.seq);
  for (const row of rows) {
    if (!targets.includes(row.seq)) continue;
    // `WHERE … state = 'inflight'` (the requeue guard) must not touch a row
    // that has since parked; the pass-opening reset additionally sweeps up
    // `retrying`, which is how an op the server refused temporarily gets its
    // ONE attempt per pass.
    const stateIn = sql.match(/state IN \(([^)]*)\)/);
    if (stateIn) {
      const allowed = [...stateIn[1].matchAll(/'(\w+)'/g)].map(
        (match) => match[1],
      );
      if (!allowed.includes(row.state)) continue;
    } else if (
      /WHERE[\s\S]*state = 'inflight'/.test(sql) &&
      row.state !== "inflight"
    ) {
      continue;
    }
    if (sql.startsWith("DELETE FROM outbox")) {
      rows = rows.filter((candidate) => candidate.seq !== row.seq);
      continue;
    }
    const setState = sql.match(/SET state = '(\w+)'/);
    if (setState) row.state = setState[1];
    // The per-op verdict binds both columns positionally
    // (`SET state = ?, error_json = ?`), which is how a rejection is recorded —
    // the literal-state form above cannot express it.
    if (/SET state = \?, error_json = \?/.test(sql)) {
      row.state = String(args[0]);
      row.error_json = String(args[1]);
    } else if (sql.includes("error_json = ?")) {
      row.error_json = String(args[0]);
    }
    if (sql.includes("attempts = attempts + 1")) row.attempts += 1;
  }
}

const db = {
  runAsync: (sql: string, ...args: unknown[]) => {
    if (sql.includes("INSERT INTO conflict_shelf")) shelved.push(args);
    else run(sql, args);
    return Promise.resolve({ changes: 1, lastInsertRowId: 1 });
  },
  getFirstAsync: (sql: string) =>
    Promise.resolve({
      n: sql.includes("'retrying'")
        ? rows.filter((row) => row.state === "retrying").length
        : 0,
    }),
  getAllAsync: (sql: string, ...args: unknown[]) =>
    Promise.resolve(
      sql.includes("entity = 'media'")
        ? rows.filter((row) => row.entity === "media" && row.state === "queued")
        : sql.includes("entity = ? AND entity_id = ?")
          ? rows.filter(
              (row) => row.entity === args[0] && row.entity_id === args[1],
            )
          : rows,
    ),
};

vi.mock("./syncDb", () => ({
  getSyncDb: () => Promise.resolve(db),
  notifyMirrorChanged: () => {},
  withSyncTransaction: async (_db: unknown, task: () => Promise<void>) =>
    task(),
}));
vi.mock("./mediaSyncBridge", () => ({ scheduleMutationSync: () => {} }));
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: () => Promise.resolve(),
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));
vi.mock("./mirrorStore", () => ({
  upsertPlace: () => Promise.resolve(),
  upsertTrip: () => Promise.resolve(),
  upsertWaypoint: () => Promise.resolve(),
}));
vi.mock("./mediaUpload", () => ({
  runMediaCreateOp: (row: { seq: number }) => {
    mediaRuns.push(row.seq);
    if (mediaErrors.has(row.seq))
      return Promise.reject(mediaErrors.get(row.seq));
    if (deadMedia.has(row.seq)) return Promise.reject(new Error("file gone"));
    rows = rows.filter((candidate) => candidate.seq !== row.seq);
    return Promise.resolve("done");
  },
  runMediaDeleteOp: () => Promise.resolve("done"),
}));
vi.mock("../api/apiFetch", () => ({
  apiFetch: (_path: string, init: { body: { ops: { opId: string }[] } }) => {
    const opIds = init.body.ops.map((op) => op.opId);
    pushCalls.push(opIds);
    if (envelopeError) return Promise.reject(envelopeError);
    if (opIds.some((opId) => poison.has(opId))) {
      return Promise.reject(
        Object.assign(new Error("bad op"), { status: 400 }),
      );
    }
    const results = opIds.map((opId) => {
      const error = rejections.get(opId);
      if (error) return { opId, status: "rejected", error };
      return { opId, status: "applied", ...answers.get(opId) };
    });
    if (resultCountDelta > 0) {
      results.push({ opId: "op-ghost", status: "applied" });
    } else if (resultCountDelta < 0) {
      results.pop();
    }
    return Promise.resolve({ results });
  },
}));

const { flushOutbox } = await import("./flush");

beforeEach(() => {
  rows = [];
  poison = new Set();
  pushCalls = [];
  deadMedia = new Set();
  mediaRuns = [];
  resultCountDelta = 0;
  rejections = new Map();
  mediaErrors = new Map();
  envelopeError = null;
  answers = new Map();
  shelved = [];
});

/** An op's error record: `failures` answered failures, the first `ageMs` ago. */
function tally(code: number, failures: number, ageMs: number): string {
  return JSON.stringify({
    code,
    message: "",
    failures,
    since: new Date(Date.now() - ageMs).toISOString(),
  });
}

/** A failed status the way apiFetch throws it. */
function httpError(status: number): Error {
  return Object.assign(new Error(`API error ${status}`), { status });
}

/** The ways a request ends with no answer at all, as apiFetch and the upload
 * task mark them (noResponse.ts). */
const NO_ANSWER: [string, () => unknown][] = [
  [
    "a timeout",
    () =>
      markNoResponse(
        Object.assign(new Error("Aborted"), { name: "AbortError" }),
      ),
  ],
  [
    "a reset connection",
    () => markNoResponse(new TypeError("Network request failed")),
  ],
  [
    "a reply cut off mid-body",
    () => markNoResponse(new SyntaxError("Unexpected end of JSON input")),
  ],
];

/** What a load balancer answers while the API behind it is restarting. */
const GATEWAY_STATUSES = [502, 503, 504];

describe("who owns a rejection", () => {
  // The user's question, answered in the engine rather than on the screen: if
  // pressing Try again might work, why didn't the app press it? It does now.
  // Only a refusal a retry cannot fix reaches Sync issues.
  it("retries a rejection the server may answer differently, without telling the user", async () => {
    rows = [pushRow(1)];
    rejections.set("op-1", { code: 503, message: "upstream unavailable" });

    const summary = await flushOutbox();

    expect(rows[0].state).toBe("retrying");
    expect(summary.retrying).toBe(1);
  });

  it("parks a refusal about the request itself", async () => {
    rows = [pushRow(1)];
    rejections.set("op-1", {
      code: 409,
      message: "This place already has a track.",
    });

    const summary = await flushOutbox();

    expect(rows[0].state).toBe("blocked");
    expect(summary.retrying).toBe(0);
  });

  it("still parks an edit whose row was deleted, however the code classifies", async () => {
    // 404 on an update is delete-wins (DESIGN.md), not a flaky server.
    rows = [pushRow(1)];
    rejections.set("op-1", { code: 404, message: "not found" });

    await flushOutbox();

    expect(rows[0].state).toBe("deadRemote");
  });

  it("does not count requests that never got an answer against the op", async () => {
    // Four sends that timed out, then one the server refused for now. Counting
    // sends parked this op on the first refusal after a bad stretch of signal.
    rows = [{ ...pushRow(1), attempts: 4 }];
    rejections.set("op-1", { code: 503, message: "upstream unavailable" });

    await flushOutbox();

    expect(rows[0].state).toBe("retrying");
  });

  it("keeps retrying a temporary refusal for as long as the window lasts", async () => {
    rows = [
      {
        ...pushRow(1),
        attempts: 40,
        error_json: tally(503, 40, SYNC_GIVE_UP_AFTER_MS - 60_000),
      },
    ];
    rejections.set("op-1", { code: 503, message: "upstream unavailable" });

    await flushOutbox();

    expect(rows[0].state).toBe("retrying");
    expect(JSON.parse(String(rows[0].error_json)).failures).toBe(41);
  });

  it("hands a refusal to the user once it has lasted the whole window", async () => {
    // The backstop: "temporary" forever is not temporary, and an op retried
    // silently for ever is one nobody is ever told about.
    rows = [
      { ...pushRow(1), error_json: tally(503, 4, SYNC_GIVE_UP_AFTER_MS + 1) },
    ];
    rejections.set("op-1", { code: 503, message: "upstream unavailable" });

    await flushOutbox();

    expect(rows[0].state).toBe("blocked");
  });

  it("retries a retrying op exactly once per pass, not in a loop", async () => {
    rows = [pushRow(1)];
    rejections.set("op-1", { code: 503, message: "upstream unavailable" });

    await flushOutbox();
    expect(pushCalls).toHaveLength(1);

    // The next pass picks it up again — that is the whole mechanism — and the
    // pass it failed in does not.
    await flushOutbox();
    expect(pushCalls).toHaveLength(2);
    expect(rows[0].attempts).toBe(2);
  });
});

describe("a push that gets no usable answer", () => {
  // The whole request failed, so no op was judged: the batch goes back in the
  // queue untouched and the engine's backoff comes back for it. Mutation: park
  // or tally in sendBatch's catch and every case here turns red.
  const cases: [string, () => unknown][] = [
    ...NO_ANSWER,
    ...GATEWAY_STATUSES.map((status): [string, () => unknown] => [
      `a ${status} from the load balancer`,
      () => httpError(status),
    ]),
  ];

  it.each(cases)(
    "requeues the batch after %s, however often",
    async (_, make) => {
      rows = [pushRow(1), pushRow(2)];
      envelopeError = make();

      for (let pass = 0; pass < 20; pass += 1) {
        await expect(flushOutbox()).rejects.toBeDefined();
      }

      expect(rows.map((row) => row.state)).toEqual(["queued", "queued"]);
      expect(rows.map((row) => row.error_json)).toEqual([null, null]);

      // And it goes through the moment the link does.
      envelopeError = null;
      await flushOutbox();
      expect(rows).toEqual([]);
    },
  );
});

describe("a write the server applied whose reply was lost", () => {
  it("is finished by the replay's alreadyApplied, with nothing for the user", async () => {
    rows = [{ ...pushRow(1), attempts: 1 }];
    answers.set("op-1", { status: "alreadyApplied" });

    await flushOutbox();

    expect(rows).toEqual([]);
    expect(shelved).toEqual([]);
  });

  it("does not shelve the op's own value as a conflict", async () => {
    // The replayed update finds its own values under a newer updatedAt, and
    // jsonb hands them back in a different key order than they were sent in.
    rows = [
      {
        ...pushRow(1),
        attempts: 1,
        fields_json: JSON.stringify({
          fieldValues: { abseils: 4, grade: "3" },
        }),
        base_fields_json: JSON.stringify({ fieldValues: { grade: "2" } }),
      },
    ];
    answers.set("op-1", {
      status: "appliedWithConflict",
      conflicts: [
        { field: "fieldValues", serverValue: { grade: "3", abseils: 4 } },
      ],
    });

    await flushOutbox();

    expect(rows).toEqual([]);
    expect(shelved).toEqual([]);
  });

  // Two edits to one field went up in one batch and the reply was lost. The
  // row now holds the SECOND edit's value, so the replayed first edit is told
  // it replaced that; the second is then told it replaced the first.
  // Mutation: compare a receipt only against the op's own base and value.
  it("does not shelve a value a later queued edit of this phone wrote", async () => {
    const edit = (seq: number, from: string, to: string): Row => ({
      ...pushRow(seq),
      entity_id: "wp-1",
      attempts: 1,
      fields_json: JSON.stringify({ name: to }),
      base_fields_json: JSON.stringify({ name: from }),
    });
    rows = [edit(1, "before", "first"), pushRow(2), edit(3, "first", "second")];
    answers.set("op-1", {
      status: "appliedWithConflict",
      conflicts: [{ field: "name", serverValue: "second" }],
    });
    answers.set("op-3", {
      status: "appliedWithConflict",
      conflicts: [{ field: "name", serverValue: "first" }],
    });

    await flushOutbox();

    expect(rows).toEqual([]);
    expect(shelved).toEqual([]);
  });

  it("still shelves a value that only another row's queued edit matches", async () => {
    rows = [
      {
        ...pushRow(1),
        fields_json: JSON.stringify({ name: "mine" }),
        base_fields_json: JSON.stringify({ name: "before" }),
      },
      { ...pushRow(2), fields_json: JSON.stringify({ name: "theirs" }) },
    ];
    answers.set("op-1", {
      status: "appliedWithConflict",
      conflicts: [{ field: "name", serverValue: "theirs" }],
    });

    await flushOutbox();

    expect(shelved).toHaveLength(1);
  });

  it("still shelves a value another device wrote", async () => {
    rows = [
      {
        ...pushRow(1),
        fields_json: JSON.stringify({ name: "mine" }),
        base_fields_json: JSON.stringify({ name: "before" }),
      },
    ];
    answers.set("op-1", {
      status: "appliedWithConflict",
      conflicts: [{ field: "name", serverValue: "theirs" }],
    });

    await flushOutbox();

    expect(shelved).toHaveLength(1);
  });
});

describe("push result correlation", () => {
  // Positional results, one per op. A count mismatch is not a per-op verdict
  // either way: an EXTRA result used to index past the batch and crash with an
  // opaque TypeError ("Couldn't sync"), and a SHORT one left the trailing ops
  // inflight with attempts already bumped, recovered only by the next cycle's
  // blanket reset.
  it("refuses a reply with more results than ops", async () => {
    rows = [pushRow(1), pushRow(2)];
    resultCountDelta = 1;
    await expect(flushOutbox()).rejects.toThrow("correlation mismatch");
  });

  it("refuses a reply with fewer results than ops", async () => {
    rows = [pushRow(1), pushRow(2)];
    resultCountDelta = -1;
    await expect(flushOutbox()).rejects.toThrow("correlation mismatch");
    // Nothing was treated as applied on the strength of a partial reply.
    expect(rows.map((row) => row.seq)).toEqual([1, 2]);
  });
});

describe("media pass", () => {
  it("keeps going past a dead op instead of aborting the pass", async () => {
    rows = [mediaRow(1), mediaRow(2), mediaRow(3)];
    deadMedia.add(1);

    await expect(flushOutbox()).rejects.toThrow();

    // Every op got its turn; only the dead one is left.
    expect(mediaRuns).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.seq)).toEqual([1]);
  });

  it.each(NO_ANSWER)(
    "stops the pass when the API gives no answer: %s",
    async (_, make) => {
      // On a dead link every queued upload used to spend its own 15 s timeout
      // before the cycle reached the delta pull. The first unanswered API call
      // says the link is down for all of them. Mutation: `continue` instead
      // of `break` after the requeue in flushMediaOps.
      rows = [mediaRow(1), mediaRow(2), mediaRow(3)];
      mediaErrors.set(1, make());

      await expect(flushOutbox()).rejects.toBeDefined();

      expect(mediaRuns).toEqual([1]);
      expect(rows.map((row) => row.state)).toEqual([
        "queued",
        "queued",
        "queued",
      ]);
      expect(rows.map((row) => row.attempts)).toEqual([1, 0, 0]);
    },
  );

  it("gives the other uploads their turn after one dies mid-transfer", async () => {
    // A transfer that dies says something about that file on this link (a
    // large video on one bar), not that the API is unreachable: stopping
    // here would let it block every small photo queued behind it.
    rows = [mediaRow(1), mediaRow(2), mediaRow(3)];
    mediaErrors.set(1, markTransferCut(new Error("upload task failed")));

    await expect(flushOutbox()).rejects.toBeDefined();

    expect(mediaRuns).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.seq)).toEqual([1]);
    expect(rows[0].error_json).toBeNull();
  });

  it.each(GATEWAY_STATUSES)(
    "gives the other uploads their turn after one is answered %i",
    async (status) => {
      rows = [mediaRow(1), mediaRow(2), mediaRow(3)];
      mediaErrors.set(1, httpError(status));

      await expect(flushOutbox()).rejects.toBeDefined();

      expect(mediaRuns).toEqual([1, 2, 3]);
    },
  );

  it.each(NO_ANSWER)("never parks an upload over %s", async (_, make) => {
    // What the field trip hit: the retry ladder starts at one second, so a
    // minute of bad signal was five failed cycles, and five failures parked
    // every queued photo and track as a sync issue. Mutation: tally a
    // no-response failure in flushMediaOps and these park on pass five.
    rows = [mediaRow(1), mediaRow(2)];
    mediaErrors.set(1, make());
    mediaErrors.set(2, make());

    for (let pass = 0; pass < 20; pass += 1) {
      await expect(flushOutbox()).rejects.toBeDefined();
    }

    expect(rows.map((row) => row.state)).toEqual(["queued", "queued"]);
    expect(rows.map((row) => row.error_json)).toEqual([null, null]);
  });

  it.each(GATEWAY_STATUSES)(
    "keeps retrying an upload the server answers %i to, inside the window",
    async (status) => {
      rows = [mediaRow(1)];
      mediaErrors.set(1, httpError(status));

      for (let pass = 0; pass < 20; pass += 1) {
        await expect(flushOutbox()).rejects.toBeDefined();
      }

      expect(rows[0].state).toBe("queued");
      expect(JSON.parse(String(rows[0].error_json)).failures).toBe(20);
    },
  );

  it("parks an upload the server has refused for the whole window", async () => {
    rows = [
      mediaRow(1, { error_json: tally(503, 4, SYNC_GIVE_UP_AFTER_MS + 1) }),
    ];
    mediaErrors.set(1, httpError(503));

    await expect(flushOutbox()).rejects.toBeDefined();

    expect(rows[0].state).toBe("blocked");
    expect(JSON.parse(String(rows[0].error_json)).code).toBe(503);
  });

  it("parks an op that keeps failing, so it reaches Sync Issues", async () => {
    // A failure that is neither the link nor a temporary answer has no reason
    // to pass with time, so the count alone is the backstop.
    rows = [mediaRow(1, { error_json: tally(0, 4, 1_000) })];
    deadMedia.add(1);

    await expect(flushOutbox()).rejects.toThrow();

    expect(rows[0].state).toBe("blocked");
    expect(String(rows[0].error_json)).toContain("keeps failing");
  });

  it("requeues a failure that still has attempts left", async () => {
    rows = [mediaRow(1)];
    deadMedia.add(1);

    await expect(flushOutbox()).rejects.toThrow();

    expect(rows[0].state).toBe("queued");
    expect(rows[0].attempts).toBe(1);
  });
});

describe("envelope-level rejection", () => {
  it("parks only the offending op, not the whole batch", async () => {
    rows = [pushRow(1), pushRow(2), pushRow(3), pushRow(4)];
    poison.add("op-3");

    await flushOutbox();

    // 1, 2 and 4 applied and are gone; 3 is parked with a rejection to act on.
    expect(rows.map((row) => row.seq)).toEqual([3]);
    expect(rows[0].state).toBe("blocked");
  });

  it("bisects rather than re-sending one op at a time", async () => {
    rows = Array.from({ length: 8 }, (_, index) => pushRow(index + 1));
    poison.add("op-6");

    await flushOutbox();

    // 8 → [1-4] ok → [5-8] → [5,6] → [5] ok → [6] parked → [7,8] ok: seven
    // requests, and the last of them carries the poison op alone.
    expect(pushCalls).toHaveLength(7);
    expect(pushCalls).toContainEqual(["op-6"]);
    expect(rows.map((row) => row.seq)).toEqual([6]);
  });

  it("drains a clean batch in one request", async () => {
    rows = [pushRow(1), pushRow(2)];

    await flushOutbox();

    expect(pushCalls).toEqual([["op-1", "op-2"]]);
    expect(rows).toEqual([]);
  });
});

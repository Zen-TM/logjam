// A batch is gathered over the WHOLE list, not from a run of adjacent rows,
// because the inbox sorts unread-first and reading three of twelve moves them
// away from the rest. That property is the one worth a test: everything about
// the collapse looks right on a freshly-arrived batch where the rows happen to
// be neighbours.
import { describe, expect, it } from "vitest";

import type { TNotification } from "../api/types";
import {
  batchKeyFromRowId,
  batchKeyOf,
  batchLabel,
  batchPendingFileSends,
  collapseBatches,
  findNotificationBatches,
} from "./notificationBatches";

const BATCH = "11111111-1111-4111-8111-111111111111";

function shared(id: string, opts: { batchId?: string; read?: boolean } = {}): TNotification {
  return {
    id,
    type: "item_shared",
    read: opts.read ?? false,
    createdAt: "2026-08-30T01:00:00.000Z",
    payload: {
      entityType: "waypoint",
      entityId: `w-${id}`,
      sharedById: "bob-id",
      sharedByUsername: "bob",
      ...(opts.batchId ? { batchId: opts.batchId } : {}),
    },
  } as TNotification;
}

function sent(
  id: string,
  opts: { batchId?: string; status?: string; read?: boolean } = {},
): TNotification {
  return {
    id,
    type: "file_sent",
    read: opts.read ?? false,
    createdAt: "2026-08-30T01:00:00.000Z",
    payload: {
      fileSendId: `fs-${id}`,
      sentById: "bob-id",
      sentByUsername: "bob",
      filename: `${id}.gpx`,
      ...(opts.status ? { fileSendStatus: opts.status } : {}),
      ...(opts.batchId ? { batchId: opts.batchId } : {}),
    },
  } as TNotification;
}

describe("batchKeyOf", () => {
  it("is null without a batchId — every share made one at a time stays a row", () => {
    expect(batchKeyOf(shared("a"))).toBeNull();
  });

  it("keys on the VERB as well as the batch, so one action's shares and copies never merge", () => {
    expect(batchKeyOf(shared("a", { batchId: BATCH }))).toBe(`${BATCH}:shares`);
    expect(batchKeyOf(sent("b", { batchId: BATCH }))).toBe(`${BATCH}:files`);
  });

  it("ignores a batchId on a kind that is never batched", () => {
    const friendRequest = {
      id: "f",
      type: "friend_request",
      read: false,
      createdAt: "2026-08-30T01:00:00.000Z",
      payload: { friendshipId: "fr1", batchId: BATCH },
    } as TNotification;
    expect(batchKeyOf(friendRequest)).toBeNull();
  });
});

describe("findNotificationBatches", () => {
  it("gathers members that are NOT adjacent — unread-first splits every part-read batch", () => {
    const list = [
      shared("a", { batchId: BATCH }),
      sent("x"),
      shared("b", { batchId: BATCH, read: true }),
    ];
    const batches = findNotificationBatches(list);
    const batch = batches.get(`${BATCH}:shares`)!;
    expect(batch.items.map((n) => n.id)).toEqual(["a", "b"]);
    expect(batch.unreadCount).toBe(1);
    // The FIRST in list order, which under unread-first keeps the header where
    // the unread rows are.
    expect(batch.representative.id).toBe("a");
  });

  it("splits one mixed action into a share batch and a file batch", () => {
    const batches = findNotificationBatches([
      shared("a", { batchId: BATCH }),
      shared("b", { batchId: BATCH }),
      sent("c", { batchId: BATCH }),
      sent("d", { batchId: BATCH }),
    ]);
    expect([...batches.keys()].sort()).toEqual([`${BATCH}:files`, `${BATCH}:shares`]);
  });

  it("is not a batch at one member — a header over one row is worse than the row", () => {
    const batches = findNotificationBatches([
      shared("a", { batchId: BATCH }),
      sent("c", { batchId: BATCH }),
      sent("d", { batchId: BATCH }),
    ]);
    expect(batches.has(`${BATCH}:shares`)).toBe(false);
    expect(batches.has(`${BATCH}:files`)).toBe(true);
  });
});

describe("collapseBatches", () => {
  const list = [
    shared("a", { batchId: BATCH }),
    sent("x"),
    shared("b", { batchId: BATCH, read: true }),
    shared("c", { batchId: BATCH, read: true }),
  ];
  const batches = findNotificationBatches(list);
  const headerId = `batch:${BATCH}:shares`;

  it("shows one HEADER row for a collapsed batch, in its first member's place", () => {
    expect(collapseBatches(list, batches, new Set()).map((n) => n.id)).toEqual([
      headerId,
      "x",
    ]);
  });

  it("lists EVERY member when expanded — the header is not one of them", () => {
    const rows = collapseBatches(list, batches, new Set([`${BATCH}:shares`]));
    // The bug this pins: with the first member doubling as the header, "alice
    // shared 2 items" expanded to ONE named row and the other item was never
    // shown. b and c were also separated from a by an unrelated row, so this
    // asserts the gathering too.
    expect(rows.map((n) => n.id)).toEqual([headerId, "a", "b", "c", "x"]);
  });

  it("gives the header an id of its own, so it cannot collide with a member", () => {
    const rows = collapseBatches(list, batches, new Set([`${BATCH}:shares`]));
    const ids = rows.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(batchKeyFromRowId(headerId)).toBe(`${BATCH}:shares`);
    expect(batchKeyFromRowId("a")).toBeNull();
  });

  it("leaves an unbatched list exactly as it was", () => {
    const plain = [shared("a"), sent("b")];
    expect(collapseBatches(plain, new Map(), new Set())).toEqual(plain);
  });
});

describe("batchLabel", () => {
  it("keeps each verb's own word", () => {
    const shares = findNotificationBatches([
      shared("a", { batchId: BATCH }),
      shared("b", { batchId: BATCH }),
    ]).get(`${BATCH}:shares`)!;
    expect(batchLabel(shares)).toBe("bob shared 2 items with you");

    const files = findNotificationBatches([
      sent("c", { batchId: BATCH }),
      sent("d", { batchId: BATCH }),
    ]).get(`${BATCH}:files`)!;
    expect(batchLabel(files)).toBe("bob sent you 2 files");
  });
});

describe("batchPendingFileSends", () => {
  it("offers nothing on a batch of shares — a grant has no answer", () => {
    const shares = findNotificationBatches([
      shared("a", { batchId: BATCH }),
      shared("b", { batchId: BATCH }),
    ]).get(`${BATCH}:shares`)!;
    expect(batchPendingFileSends(shares)).toEqual([]);
  });

  it("skips members already answered or lapsed", () => {
    const files = findNotificationBatches([
      sent("a", { batchId: BATCH }),
      sent("b", { batchId: BATCH, status: "accepted" }),
      sent("c", { batchId: BATCH, status: "expired" }),
      sent("d", { batchId: BATCH }),
    ]).get(`${BATCH}:files`)!;
    expect(batchPendingFileSends(files).map((n) => n.id)).toEqual(["a", "d"]);
  });
});

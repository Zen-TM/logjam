import { describe, it, expect } from "vitest";
import {
  notificationLabel,
  notificationHaystack,
  notificationKind,
  notificationPlaceId,
  groupNotificationsByDay,
  bulkReadAction,
  selectionCountLabel,
  isResolvedElsewhereError,
  batchKeyOf,
  findNotificationBatches,
  collapseBatches,
  batchHeaderRow,
  batchKeyFromRowId,
  batchLabel,
  batchPendingFileSends,
  countBatchRows,
  tallyNotifications,
  idRange,
} from "./notifications.js";
import { ApiError } from "./apiErrors.js";
import type { TNotification } from "./apiTypes.js";

function notif(type: string, payload: Record<string, unknown> = {}, read = false): TNotification {
  return { id: "n1", type, payload, read, createdAt: "2026-07-23T00:00:00.000Z" };
}

describe("notificationLabel", () => {
  it("labels friend requests with the requester username", () => {
    expect(notificationLabel(notif("friend_request", { requesterUsername: "bob" }))).toEqual({
      text: "bob sent you a friend request",
    });
  });

  it("labels accepted friend requests", () => {
    expect(
      notificationLabel(notif("friend_request_accepted", { acceptedByUsername: "carol" })),
    ).toEqual({ text: "carol accepted your friend request" });
  });

  it("labels place shares", () => {
    expect(
      notificationLabel(
        notif("place_shared", { sharedByUsername: "bob", placeName: "Claustral" }),
      ),
    ).toEqual({ text: "bob shared Claustral with you" });
  });

  it("labels item shares by kind", () => {
    expect(
      notificationLabel(
        notif("item_shared", {
          sharedByUsername: "bob",
          entityType: "waypoint",
          entityId: "w1",
        }),
      ),
    ).toEqual({ text: "bob shared a waypoint with you" });
    expect(
      notificationLabel(notif("item_shared", { sharedByUsername: "bob", entityType: "topoJob" })).text,
    ).toBe("bob shared a LiDAR topo with you");
    expect(
      notificationLabel(notif("item_shared", { sharedByUsername: "bob", entityType: "unknown" })).text,
    ).toBe("bob shared an item with you");
  });

  it("labels file sent with filename", () => {
    expect(
      notificationLabel(
        notif("file_sent", {
          fileSendId: "s1",
          sentByUsername: "bob",
          filename: "Notes.gpx",
        }),
      ).text,
    ).toBe("bob sent you Notes.gpx");
  });

  it("adds warning for expired file send", () => {
    const label = notificationLabel(
      notif("file_sent", {
        fileSendId: "s1",
        sentByUsername: "bob",
        filename: "Notes.gpx",
        fileSendStatus: "expired",
      }),
    );
    expect(label.text).toBe("bob sent you Notes.gpx");
    expect(label.warning).toBe("This file expired. Ask bob to send it again.");
  });

  it("labels topo completion and warnings", () => {
    expect(notificationLabel(notif("topo_complete", { jobName: "Kanangra" }))).toEqual({
      text: "Kanangra map ready",
    });
    const withWarn = notificationLabel(
      notif("topo_complete", { jobName: "Kanangra", osmFailed: true }),
    );
    expect(withWarn.warning).toMatch(/Roads and labels/);
  });

  it("labels topo export complete, failed, and skipped", () => {
    expect(
      notificationLabel(notif("topo_export_complete", { format: "pdf", jobName: "Kanangra" })).text,
    ).toBe("PDF export for Kanangra ready");
    expect(
      notificationLabel(
        notif("topo_export_complete", { status: "failed", format: "pdf", errorMessage: "boom" }),
      ),
    ).toEqual({ text: "PDF export failed", warning: "boom" });
    expect(
      notificationLabel(notif("topo_export_skipped", { reason: "skip reason" })),
    ).toEqual({ text: "Auto-export didn't run", warning: "skip reason" });
  });

  it("labels geo pdf complete and failure", () => {
    expect(notificationLabel(notif("geo_pdf_complete", {})).text).toBe("GeoPDF ready");
    expect(
      notificationLabel(notif("geo_pdf_complete", { status: "failed", errorMessage: "no extent" })),
    ).toEqual({ text: "Couldn't create GeoPDF", warning: "no extent" });
  });

  it("labels egress quota warning and exceeded", () => {
    expect(notificationLabel(notif("egress_quota_warning")).text).toBe(
      "Approaching your monthly download limit",
    );
    expect(notificationLabel(notif("egress_quota_exceeded"))).toEqual({
      text: "Monthly download limit reached",
      warning: "Downloads resume when the limit resets next month.",
    });
  });

  it("falls back gracefully for missing payload and unknown types", () => {
    expect(notificationLabel(notif("friend_request")).text).toBe("Someone sent you a friend request");
    expect(notificationLabel(notif("future_type")).text).toBe("Notification");
  });
});

describe("notificationHaystack", () => {
  it("matches words in text and warning case-insensitively", () => {
    const haystack = notificationHaystack(
      notif("place_shared", { sharedByUsername: "Bob", placeName: "Claustral" }),
    );
    expect(haystack).toContain("claustral");
    expect(haystack).toContain("bob");
  });
});

describe("notificationKind", () => {
  it("maps types to kinds", () => {
    expect(notificationKind(notif("place_shared"))).toBe("share");
    expect(notificationKind(notif("item_shared"))).toBe("share");
    expect(notificationKind(notif("file_sent"))).toBe("file");
    expect(notificationKind(notif("friend_request"))).toBe("people");
    expect(notificationKind(notif("friend_request_accepted"))).toBe("people");
    expect(notificationKind(notif("topo_failed"))).toBe("problem");
    expect(notificationKind(notif("topo_complete"))).toBe("topo");
    expect(notificationKind(notif("topo_export_complete"))).toBe("export");
    expect(notificationKind(notif("topo_export_complete", { status: "failed" }))).toBe("problem");
    expect(notificationKind(notif("geo_pdf_complete"))).toBe("geoPdf");
    expect(notificationKind(notif("geo_pdf_complete", { status: "failed" }))).toBe("problem");
    expect(notificationKind(notif("egress_quota_warning"))).toBe("problem");
    expect(notificationKind(notif("egress_quota_exceeded"))).toBe("problem");
  });
});

describe("notificationPlaceId", () => {
  it("extracts placeId if valid string", () => {
    expect(notificationPlaceId(notif("place_shared", { placeId: "p1" }))).toBe("p1");
    expect(notificationPlaceId(notif("place_shared", {}))).toBeNull();
  });
});

describe("groupNotificationsByDay", () => {
  it("groups by calendar day", () => {
    const now = new Date("2026-07-23T12:00:00.000Z");
    const items = [
      { id: "1", type: "friend_request", payload: {}, read: false, createdAt: "2026-07-23T05:00:00.000Z" },
      { id: "2", type: "friend_request", payload: {}, read: false, createdAt: "2026-07-22T05:00:00.000Z" },
    ];
    const grouped = groupNotificationsByDay(items, now);
    expect(grouped.length).toBeGreaterThanOrEqual(1);
    expect(grouped[0].data.length).toBeGreaterThan(0);
  });
});

describe("bulkReadAction", () => {
  const read = (id: string) => ({ id, read: true });
  const unread = (id: string) => ({ id, read: false });

  it("offers nothing for empty selection", () => {
    expect(bulkReadAction([])).toBeNull();
  });

  it("marks all-read as unread", () => {
    const action = bulkReadAction([read("a"), read("b")]);
    expect(action).toMatchObject({ read: false, icon: "eye-off", label: "Mark as unread" });
    expect(action?.ids).toEqual(["a", "b"]);
  });

  it("marks all-unread as read", () => {
    const action = bulkReadAction([unread("a"), unread("b")]);
    expect(action).toMatchObject({ read: true, icon: "eye", label: "Mark as read" });
    expect(action?.ids).toEqual(["a", "b"]);
  });

  it("touches only unread rows in mixed selection", () => {
    const action = bulkReadAction([read("a"), unread("b"), read("c")]);
    expect(action?.read).toBe(true);
    expect(action?.ids).toEqual(["b"]);
    expect(action?.label).toBe("Mark the unread ones as read");
  });
});

describe("selectionCountLabel", () => {
  it("formats count label with unread indicator", () => {
    expect(selectionCountLabel([{ read: true }, { read: false }])).toBe("2 selected · 1 unread");
    expect(selectionCountLabel([{ read: true }])).toBe("1 selected");
  });
});

describe("isResolvedElsewhereError", () => {
  it("recognizes 400, 404, 409 ApiErrors", () => {
    expect(isResolvedElsewhereError(new ApiError(400, "/test", "POST"))).toBe(true);
    expect(isResolvedElsewhereError(new ApiError(404, "/test", "POST"))).toBe(true);
    expect(isResolvedElsewhereError(new ApiError(409, "/test", "POST"))).toBe(true);
    expect(isResolvedElsewhereError(new ApiError(500, "/test", "POST"))).toBe(false);
    expect(isResolvedElsewhereError(new Error("Generic"))).toBe(false);
  });
});

describe("notificationBatches", () => {
  const BATCH = "batch-123";
  const shared = (id: string, opts: { batchId?: string; read?: boolean } = {}): TNotification => ({
    id,
    type: "item_shared",
    read: opts.read ?? false,
    createdAt: "2026-08-30T01:00:00.000Z",
    payload: {
      entityType: "waypoint",
      entityId: `w-${id}`,
      sharedByUsername: "bob",
      ...(opts.batchId ? { batchId: opts.batchId } : {}),
    },
  });

  it("keys batches and finds batch sets of 2 or more", () => {
    expect(batchKeyOf(shared("a"))).toBeNull();
    expect(batchKeyOf(shared("a", { batchId: BATCH }))).toBe(`${BATCH}:shares`);

    const list = [shared("a", { batchId: BATCH }), shared("b", { batchId: BATCH })];
    const batches = findNotificationBatches(list);
    expect(batches.size).toBe(1);
    const b = batches.get(`${BATCH}:shares`)!;
    expect(b.items.length).toBe(2);
    expect(batchLabel(b)).toBe("bob shared 2 items with you");

    const header = batchHeaderRow(b);
    expect(batchKeyFromRowId(header.id)).toBe(`${BATCH}:shares`);

    const collapsed = collapseBatches(list, batches, new Set());
    expect(collapsed.length).toBe(1);
    expect(countBatchRows(collapsed, batches)).toBe(1);

    const tally = tallyNotifications(list);
    expect(tally).toEqual({ total: 1, unread: 1 });
  });

  describe("idRange", () => {
    const ids = ["a", "b", "c", "d", "e"];

    it("returns all ids between from and to inclusive", () => {
      expect(idRange(ids, "b", "d")).toEqual(["b", "c", "d"]);
      expect(idRange(ids, "d", "b")).toEqual(["b", "c", "d"]);
    });

    it("returns just to when from is null or missing from ids", () => {
      expect(idRange(ids, null, "c")).toEqual(["c"]);
      expect(idRange(ids, "nonexistent", "c")).toEqual(["c"]);
    });

    it("returns empty array when to is not in ids", () => {
      expect(idRange(ids, "b", "missing")).toEqual([]);
    });
  });
});

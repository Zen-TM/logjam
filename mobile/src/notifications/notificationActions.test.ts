import { describe, it, expect } from "vitest";
import { ApiError } from "@logjam/shared";

import type { TNotification } from "../api/types";
import { isResolvedElsewhereError, notificationActions } from "./notificationActions";

function notification(type: string, payload: Record<string, unknown>): TNotification {
  return { id: "n1", type, payload, read: false, createdAt: "2026-08-30T01:00:00Z" };
}

describe("notificationActions", () => {
  it("offers nothing on a notification that only reports", () => {
    expect(notificationActions(notification("topo_complete", { jobId: "j1" }))).toBeNull();
    expect(
      notificationActions(notification("friend_request_accepted", { friendshipId: "f1" })),
    ).toBeNull();
    expect(notificationActions(notification("canyon_shared", { canyonId: "c1" }))).toBeNull();
  });

  it("offers accept + decline on a friend request", () => {
    const actions = notificationActions(
      notification("friend_request", { friendshipId: "f1", requesterUsername: "bob" }),
    );
    expect(actions?.type).toBe("friend_request");
    expect(actions?.targetId).toBe("f1");
    expect(actions?.actions.map((a) => a.kind)).toEqual(["accept", "decline"]);
  });

  it("offers save + turn down on a pending file send", () => {
    const actions = notificationActions(
      notification("file_sent", {
        fileSendId: "s1",
        filename: "Claustral.gpx",
        sentByUsername: "bob",
        fileSendStatus: "pending",
      }),
    );
    expect(actions?.type).toBe("file_sent");
    expect(actions?.targetId).toBe("s1");
    expect(actions?.actions.map((a) => a.label)).toEqual(["Save a copy", "Turn down"]);
    expect(actions?.pill).toBeNull();
  });

  // `accepted` means the URL was issued, not that the bytes landed, so the
  // retry survives and there is nothing left to decline.
  it("keeps the download on offer once accepted, and drops decline", () => {
    const actions = notificationActions(
      notification("file_sent", {
        fileSendId: "s1",
        filename: "Claustral.gpx",
        fileSendStatus: "accepted",
      }),
    );
    expect(actions?.actions.map((a) => a.kind)).toEqual(["accept"]);
    expect(actions?.actions[0].label).toBe("Download again");
    expect(actions?.pill).toBe("Saved");
  });

  // Every decline is a dialog: side by side in a row there is no overflow sheet
  // left to keep "no" away from "yes".
  it("confirms every decline and no accept", () => {
    for (const n of [
      notification("friend_request", { friendshipId: "f1", requesterUsername: "bob" }),
      notification("file_sent", { fileSendId: "s1", filename: "Claustral.gpx" }),
    ]) {
      const actions = notificationActions(n);
      for (const action of actions!.actions) {
        expect(Boolean(action.confirm)).toBe(action.kind === "decline");
      }
    }
  });

  it("reports every action, so none of them can look like a no-op", () => {
    for (const n of [
      notification("friend_request", { friendshipId: "f1", requesterUsername: "bob" }),
      notification("file_sent", { fileSendId: "s1", filename: "x.gpx" }),
      notification("file_sent", { fileSendId: "s1", filename: "x.gpx", fileSendStatus: "accepted" }),
    ]) {
      for (const action of notificationActions(n)!.actions) {
        expect(action.success.length).toBeGreaterThan(0);
        expect(action.failure.length).toBeGreaterThan(0);
      }
    }
  });

  // "share" is the OTHER verb — live and revocable. A send is a copy, and the
  // way back is another send.
  it("never offers to 'share' a turned-down file back", () => {
    const body = notificationActions(
      notification("file_sent", { fileSendId: "s1", filename: "x.gpx", sentByUsername: "bob" }),
    )!.actions.find((a) => a.kind === "decline")!.confirm!.body;
    expect(body).not.toMatch(/shares?\b/i);
    expect(body).toContain("send it again");
  });

  // The recipient cannot answer "keep this?" without knowing what is on offer.
  it("names the file and the sender in the turn-down body", () => {
    const actions = notificationActions(
      notification("file_sent", {
        fileSendId: "s1",
        filename: "Claustral.gpx",
        sentByUsername: "bob",
      }),
    );
    const body = actions!.actions.find((a) => a.kind === "decline")!.confirm!.body;
    expect(body).toContain("Claustral.gpx");
    expect(body).toContain("bob");
  });

  // The invariant that replaced "the notification query and the inbox endpoint
  // use one filter": expired sends are deliberately KEPT by the server so the
  // row can explain itself, and it is this that stops them offering a button
  // the endpoint would refuse.
  it("offers nothing at all once the send has expired", () => {
    expect(
      notificationActions(
        notification("file_sent", {
          fileSendId: "s1",
          filename: "x.gpx",
          sentByUsername: "bob",
          fileSendStatus: "expired",
        }),
      ),
    ).toBeNull();
  });

  it("renders nothing rather than unwired buttons when the id is missing", () => {
    expect(notificationActions(notification("friend_request", {}))).toBeNull();
    expect(notificationActions(notification("file_sent", { filename: "x.gpx" }))).toBeNull();
  });
});

describe("isResolvedElsewhereError", () => {
  it("treats already-actioned statuses as dead, not retryable", () => {
    for (const status of [400, 404, 409]) {
      expect(isResolvedElsewhereError(new ApiError(status, "/friends/f1/accept", "PATCH"))).toBe(
        true,
      );
    }
  });

  it("leaves a blip or a server fault retryable", () => {
    expect(isResolvedElsewhereError(new ApiError(500, "/friends/f1/accept", "PATCH"))).toBe(false);
    expect(isResolvedElsewhereError(new ApiError(401, "/friends/f1/accept", "PATCH"))).toBe(false);
    expect(isResolvedElsewhereError(new Error("Network request failed"))).toBe(false);
  });
});

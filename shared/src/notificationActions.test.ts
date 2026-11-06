import { describe, it, expect } from "vitest";
import { ApiError } from "./apiErrors.js";

import type { TNotification } from "./apiTypes.js";
import {
  isResolvedElsewhereError,
  notificationActions as actionsFor,
} from "./notificationActions.js";

const notificationActions = (n: TNotification) => actionsFor(n, "gps");

function notification(
  type: string,
  payload: Record<string, unknown>,
): TNotification {
  return {
    id: "n1",
    type,
    payload,
    read: false,
    createdAt: "2026-08-30T01:00:00Z",
  };
}

describe("notificationActions", () => {
  it("offers nothing on a notification that only reports", () => {
    expect(
      notificationActions(notification("topo_complete", { jobId: "j1" })),
    ).toBeNull();
    expect(
      notificationActions(
        notification("friend_request_accepted", { friendshipId: "f1" }),
      ),
    ).toBeNull();
    expect(
      notificationActions(notification("place_shared", { placeId: "c1" })),
    ).toBeNull();
  });

  it("offers accept + decline on a friend request", () => {
    const actions = notificationActions(
      notification("friend_request", {
        friendshipId: "f1",
        requesterUsername: "bob",
      }),
    );
    expect(actions?.type).toBe("friend_request");
    expect(actions?.targetId).toBe("f1");
    expect(actions?.actions.map((a) => a.kind)).toEqual(["accept", "decline"]);
  });

  // Mutation: return null for either plan kind, or give the join request the
  // invite's words (the leader would read "You joined the plan.").
  it("offers accept + decline on a plan invite and on a join request", () => {
    const invite = notificationActions(
      notification("plan_invited", { planId: "p1" }),
    );
    expect(invite?.type).toBe("plan_invite");
    expect(invite?.targetId).toBe("p1");
    expect(invite?.actions.map((a) => [a.kind, a.label])).toEqual([
      ["accept", "Accept"],
      ["decline", "Decline"],
    ]);
    expect(invite?.actions[0]?.success).toBe("You joined the plan.");

    const request = notificationActions(
      notification("plan_join_request", {
        planId: "p1",
        requesterId: "u2",
        requesterUsername: "carol",
      }),
    );
    expect(request?.type).toBe("plan_join_request");
    expect([request?.targetId, request?.requesterId]).toEqual(["p1", "u2"]);
    expect(request?.actions[0]?.success).toBe("carol is in.");
    expect(request?.actions[1]?.confirm?.title).toBe("Decline carol?");
  });

  it("offers nothing on a plan notification missing the ids its calls need", () => {
    expect(notificationActions(notification("plan_invited", {}))).toBeNull();
    expect(
      notificationActions(notification("plan_join_request", { planId: "p1" })),
    ).toBeNull();
  });

  it("offers save + decline on a pending file send", () => {
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
    expect(actions?.actions.map((a) => a.label)).toEqual(["Accept", "Decline"]);
    expect(actions?.pill).toBeNull();
  });

  // Mutation: return "Accept" on web too, and a download reads as an offer.
  it("calls accepting a sent file a download on Logjam Web", () => {
    const sent = notification("file_sent", {
      fileSendId: "s1",
      filename: "Claustral.gpx",
      fileSendStatus: "pending",
    });
    expect(actionsFor(sent, "web")?.actions.map((a) => a.label)).toEqual([
      "Download",
      "Decline",
    ]);
  });

  // Mutation: return the phone's pill or failure on web, and Logjam Web says
  // "Saved" or "Couldn't save" about a button called Download.
  it("words Logjam Web's accepted pill and failure as a download", () => {
    for (const fileSendStatus of ["pending", "accepted"]) {
      const web = actionsFor(
        notification("file_sent", {
          fileSendId: "s1",
          filename: "Claustral.gpx",
          fileSendStatus,
        }),
        "web",
      );
      expect(web?.actions[0].failure).toBe("Couldn't download that file.");
      expect(web?.pill).toBe(
        fileSendStatus === "accepted" ? "Downloaded" : null,
      );
    }
  });

  // `accepted` means the URL was issued, not that the bytes landed, and a
  // client cannot always tell they did not (a cancelled browser download, a
  // GeoPDF kept only on another device). Mutation that turns it red: return
  // `actions: []` for an accepted send, as it did when only an in-session
  // failure offered a retry.
  it("still offers a quiet fetch once a send is accepted", () => {
    const accepted = notification("file_sent", {
      fileSendId: "s1",
      filename: "Claustral.gpx",
      fileSendStatus: "accepted",
    });
    const target = notificationActions(accepted);
    expect(target?.pill).toBe("Saved");
    expect(
      target?.actions.map((a) => [a.kind, a.label, a.quiet, a.confirm]),
    ).toEqual([["accept", "Download again", true, null]]);
  });

  // Every decline is a dialog, the friend request's included (ADR 0016), and
  // no accept is. Mutation that turns it red: take the confirm off the friend
  // decline in `friendRequestAnswers`.
  it("confirms every decline and no accept", () => {
    for (const n of [
      notification("friend_request", {
        friendshipId: "f1",
        requesterUsername: "bob",
      }),
      notification("file_sent", {
        fileSendId: "s1",
        filename: "Claustral.gpx",
      }),
    ]) {
      for (const action of notificationActions(n)!.actions) {
        expect(Boolean(action.confirm)).toBe(action.kind === "decline");
      }
    }
  });

  it("reports every action, so none of them can look like a no-op", () => {
    for (const n of [
      notification("friend_request", {
        friendshipId: "f1",
        requesterUsername: "bob",
      }),
      notification("file_sent", { fileSendId: "s1", filename: "x.gpx" }),
      notification("file_sent", {
        fileSendId: "s1",
        filename: "x.gpx",
        fileSendStatus: "accepted",
      }),
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
      notification("file_sent", {
        fileSendId: "s1",
        filename: "x.gpx",
        sentByUsername: "bob",
      }),
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
    const body = actions!.actions.find((a) => a.kind === "decline")!.confirm!
      .body;
    expect(body).toContain("Claustral.gpx");
    expect(body).toContain("bob");
  });

  // Expired sends are deliberately kept by the server so the row can explain
  // itself, and this stops them offering a button the inbox endpoint would
  // refuse.
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
    expect(
      notificationActions(notification("file_sent", { filename: "x.gpx" })),
    ).toBeNull();
  });
});

describe("isResolvedElsewhereError", () => {
  it("treats already-actioned statuses as dead, not retryable", () => {
    for (const status of [400, 404, 409]) {
      expect(
        isResolvedElsewhereError(
          new ApiError(status, "/friends/f1/accept", "PATCH"),
        ),
      ).toBe(true);
    }
  });

  it("leaves a blip or a server fault retryable", () => {
    expect(
      isResolvedElsewhereError(
        new ApiError(500, "/friends/f1/accept", "PATCH"),
      ),
    ).toBe(false);
    expect(
      isResolvedElsewhereError(
        new ApiError(401, "/friends/f1/accept", "PATCH"),
      ),
    ).toBe(false);
    expect(isResolvedElsewhereError(new Error("Network request failed"))).toBe(
      false,
    );
  });
});

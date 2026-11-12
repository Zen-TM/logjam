import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_DESTINATIONS,
  NOTIFICATION_TYPES,
  SHARABLE_ENTITY_TYPES,
  type TNotification,
} from "@logjam/shared";
import { findRouteById, inboxDestination } from "./inboxModel";

type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const SAMPLE_PAYLOADS = {
  friend_request: {},
  friend_request_accepted: {},
  place_shared: { placeId: "p1" },
  item_shared: { entityType: "route", entityId: "r1" },
  file_sent: { fileSendStatus: "accepted", filename: "x.gpx" },
  topo_complete: { jobId: "j1" },
  topo_failed: {},
  topo_export_complete: {},
  topo_export_skipped: {},
  egress_quota_warning: {},
  egress_quota_exceeded: {},
  announcement: {},
  plan_invited: { planId: "pl1" },
  plan_join_request: { planId: "pl1" },
  plan_join_approved: { planId: "pl1" },
  plan_member_joined: { planId: "pl1" },
  plan_access_ended: { planId: "pl1", reason: "removed" },
} satisfies Record<NotificationType, Record<string, unknown>>;

function notification(
  type: string,
  payload: Record<string, unknown> = {},
): TNotification {
  return {
    id: "n1",
    type,
    payload,
    read: false,
    createdAt: "2026-09-14T00:00:00.000Z",
  };
}

describe("inboxDestination", () => {
  it("opens the place a share is about", () => {
    expect(
      inboxDestination(notification("place_shared", { placeId: "p1" })),
    ).toEqual({
      kind: "place",
      label: "Open place",
      placeId: "p1",
    });
  });

  // Mutation: send a finished sharpened area to a page instead of Layers →
  // Terrain → Sharpened areas.
  it("sends a finished map to where it is listed", () => {
    expect(
      inboxDestination(notification("topo_complete", { jobId: "j1" })),
    ).toEqual({ kind: "sharpened", label: "Show" });
  });

  it("goes nowhere for a failure, which made nothing to look at", () => {
    expect(
      inboxDestination(
        notification("topo_export_complete", { status: "failed" }),
      ),
    ).toBeNull();
  });

  // Mutation: drop the plan case, and a plan notification's ⋯ has nowhere
  // to go though its row opens the plan.
  it("opens a plan where its notification is acted on", () => {
    expect(
      inboxDestination(notification("plan_join_request", { planId: "p" })),
    ).toEqual({
      kind: "plan",
      label: "Open plan",
      target: { planId: "p", view: "people", invited: false },
    });
    expect(
      inboxDestination(
        notification("plan_access_ended", { planId: "p", reason: "left" }),
      ),
    ).toBeNull();
  });

  // An export is a file the row's Download hands over; no page lists it.
  // Mutation: send it to a page and this is not null.
  it("goes nowhere for an export, finished or failed", () => {
    for (const status of ["completed", "failed"]) {
      expect(
        inboxDestination(notification("topo_export_complete", { status })),
      ).toBeNull();
    }
  });

  it("goes nowhere for a file send, which the row itself answers", () => {
    expect(
      inboxDestination(notification("file_sent", { fileSendId: "f1" })),
    ).toBeNull();
  });

  it("follows a shared route to its own page, and an unnamed one nowhere", () => {
    expect(
      inboxDestination(
        notification("item_shared", { entityType: "route", entityId: "r1" }),
      ),
    ).toMatchObject({ kind: "way", routeId: "r1" });
    expect(
      inboxDestination(notification("item_shared", { entityType: "route" })),
    ).toBeNull();
    expect(
      inboxDestination(
        notification("item_shared", { entityType: "somethingNew" }),
      ),
    ).toBeNull();
  });

  // Mutation that turns it red: add a type to NOTIFICATION_TYPES whose
  // declared destination this router does not reach (or drop a branch here).
  it("reaches a destination for every type that declares one", () => {
    // Logjam Web has no Saved, so a kept file send stays in its row, and an
    // announcement opens its own dialog.
    const none = new Set(["file", "message", "none"]);
    for (const type of NOTIFICATION_TYPES) {
      const kind = NOTIFICATION_DESTINATIONS[type];
      const n = notification(type, SAMPLE_PAYLOADS[type]);
      expect(inboxDestination(n) === null, type).toBe(none.has(kind));
    }
  });

  // Mutation that turns it red: add a SHARABLE_ENTITY_TYPES entry the switch
  // in `inboxDestination` does not name.
  it("opens every kind of shared item", () => {
    for (const entityType of SHARABLE_ENTITY_TYPES) {
      expect(
        inboxDestination(
          notification("item_shared", { entityType, entityId: "e1" }),
        ),
        entityType,
      ).not.toBeNull();
    }
  });
});

describe("findRouteById", () => {
  // Mutation that turns it red: return null on the first miss, which tells
  // someone their live share "was removed" when the list just hasn't loaded it.
  it("asks the server when the cached list lacks the route", async () => {
    const fresh = [{ id: "r1" }];
    const fetchAll = async () => fresh;
    expect(await findRouteById([], "r1", fetchAll)).toBe(fresh[0]);
    expect(await findRouteById([], "gone", fetchAll)).toBeNull();
  });

  it("does not fetch when the cached list has it", async () => {
    const cached = [{ id: "r1" }];
    const fetchAll = async () => {
      throw new Error("fetched");
    };
    expect(await findRouteById(cached, "r1", fetchAll)).toBe(cached[0]);
  });
});

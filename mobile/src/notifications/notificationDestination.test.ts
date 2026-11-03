// The mapping is the whole module, so the test is the table — plus the two
// rules that are easy to lose: a notification about something that does not
// exist has NO destination, and a file send only has one once it was kept.
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_DESTINATIONS,
  NOTIFICATION_TYPES,
  notificationWayTarget,
} from "@logjam/shared";

import type { TNotification } from "../api/types";
import { notificationDestination } from "./notificationDestination";

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
  payload: Record<string, unknown>,
): TNotification {
  return {
    id: "n1",
    type,
    payload,
    read: false,
    createdAt: "2026-08-31T01:00:00.000Z",
  };
}

describe("notificationDestination", () => {
  it("sends both friendship notifications to Friends", () => {
    expect(notificationDestination(notification("friend_request", {}))).toEqual(
      {
        tab: "friends",
        label: "View in Friends",
      },
    );
    expect(
      notificationDestination(notification("friend_request_accepted", {})),
    ).toEqual({ tab: "friends", label: "View in Friends" });
  });

  it("points a shared route at its own row", () => {
    expect(
      notificationDestination(
        notification("item_shared", { entityType: "route", entityId: "r1" }),
      ),
    ).toEqual({
      tab: "saved",
      label: "View in Saved",
      filter: "route",
      highlightKey: "r1",
    });
  });

  it("prefixes a shared topo job's key the way the Saved row is keyed", () => {
    expect(
      notificationDestination(
        notification("item_shared", { entityType: "topoJob", entityId: "j1" }),
      ),
    ).toMatchObject({ filter: "overlay", highlightKey: "overlay:j1" });
  });

  it("has nowhere to send a share whose payload names no entity", () => {
    expect(
      notificationDestination(
        notification("item_shared", { entityType: "route" }),
      ),
    ).toBeNull();
    expect(
      notificationDestination(
        notification("item_shared", { entityType: "place", entityId: "c1" }),
      ),
    ).toBeNull();
  });

  it("points a finished topo at the overlay filter", () => {
    expect(
      notificationDestination(notification("topo_complete", { jobId: "j2" })),
    ).toMatchObject({ filter: "overlay", highlightKey: "overlay:j2" });
  });

  it("offers nothing for a job that produced nothing", () => {
    expect(
      notificationDestination(notification("topo_failed", { jobId: "j3" })),
    ).toBeNull();
    expect(
      notificationDestination(
        notification("topo_export_skipped", { reason: "x" }),
      ),
    ).toBeNull();
  });

  it("only points at a sent file once it has been kept, and by its kind", () => {
    expect(
      notificationDestination(
        notification("file_sent", {
          fileSendId: "f1",
          filename: "test-track.gpx",
        }),
      ),
    ).toBeNull();
    expect(
      notificationDestination(
        notification("file_sent", {
          fileSendId: "f1",
          filename: "test-track.gpx",
          fileSendStatus: "accepted",
        }),
      ),
    ).toEqual({
      tab: "saved",
      label: "View in Saved",
      filter: "import",
      // The id it was given on this device is not in the payload.
      highlightKey: null,
    });
    expect(
      notificationDestination(
        notification("file_sent", {
          fileSendId: "f2",
          filename: "test-map.PDF",
          fileSendStatus: "accepted",
        }),
      ),
    ).toMatchObject({ filter: "geoPdf" });
  });

  it("leaves a place share to the sheet's own Open", () => {
    expect(
      notificationDestination(notification("place_shared", { placeId: "c1" })),
    ).toBeNull();
  });

  // Parity with Logjam Web, which opens a shared route by the same function:
  // both must point at the same route. Mutation that turns it red: key the
  // Saved row by anything but the payload's entity id.
  it("points at the route notificationWayTarget names", () => {
    const n = notification("item_shared", {
      entityType: "route",
      entityId: "r9",
    });
    expect(notificationDestination(n)).toMatchObject({
      highlightKey: notificationWayTarget(n),
    });
  });

  // Mutation that turns it red: add a type to NOTIFICATION_TYPES whose
  // declared destination this table does not reach. A place or plan is reached
  // through its own target (`notificationPlaceId`, `notificationPlanTarget`,
  // held to the same declaration in `shared`), not here.
  it("reaches a destination for every type that declares one", () => {
    const here = new Set(["friends", "item", "topo", "file"]);
    for (const type of NOTIFICATION_TYPES) {
      const n = notification(type, SAMPLE_PAYLOADS[type]);
      expect(notificationDestination(n) !== null, type).toBe(
        here.has(NOTIFICATION_DESTINATIONS[type]),
      );
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_DESTINATIONS,
  NOTIFICATION_TYPES,
  TRIP_PLANS_LIST,
} from "@logjam/shared";

import {
  destinationCall,
  notificationTapTarget,
  tapTargetCall,
} from "./tapTarget";

describe("notificationTapTarget", () => {
  it("opens the place a push names", () => {
    expect(
      notificationTapTarget({
        data: { type: "placeShared", placeId: "c-1" },
        routeEditing: false,
      }),
    ).toEqual({ kind: "place", placeId: "c-1" });
  });

  // Mutation: drop the `view`, and a join request opens on the write-up,
  // away from where it is answered.
  it("opens a join request on the plan's People", () => {
    expect(
      notificationTapTarget({
        data: { type: "plan_join_request", planId: "p-1" },
        routeEditing: false,
      }),
    ).toEqual({
      kind: "plan",
      planId: "p-1",
      view: "people",
      invited: false,
    });
  });

  // Mutation: send these to the inbox, and a push about a plan the reader is
  // in doesn't open it.
  it.each(["plan_join_approved", "plan_member_joined"])(
    "opens the plan a %s push names",
    (type) => {
      expect(
        notificationTapTarget({
          data: { type, planId: "p-1" },
          routeEditing: false,
        }),
      ).toEqual({
        kind: "plan",
        planId: "p-1",
        view: undefined,
        invited: false,
      });
    },
  );

  // Mutation: drop `invited`, and an invite push opens the member's page,
  // which 404s for someone not in the plan yet.
  it("opens an invite as its plan's preview", () => {
    expect(
      notificationTapTarget({
        data: { type: "plan_invited", planId: "p-1" },
        routeEditing: false,
      }),
    ).toEqual({ kind: "plan", planId: "p-1", view: undefined, invited: true });
  });

  // Mutation: drop the announcementId branch and these land on the bare inbox.
  it("opens the message an announcement push names", () => {
    expect(
      notificationTapTarget({
        data: { type: "announcement", announcementId: "a-1" },
        routeEditing: false,
      }),
    ).toEqual({ kind: "announcement", announcementId: "a-1" });
  });

  it.each([
    ["a plan the recipient lost", { type: "plan_access_ended", planId: "p-1" }],
    ["no id at all", { type: "friendRequest" }],
    ["an id that is not a string", { placeId: 7 }],
    ["a null id", { placeId: null }],
    ["an announcement id that is not a string", { announcementId: 7 }],
    ["an empty announcement id", { announcementId: "" }],
    ["an empty payload", {}],
    ["a payload that is not an object", "placeId=c-1"],
    ["no payload", undefined],
    ["a null payload", null],
  ])("falls back to the inbox on %s", (_why, data) => {
    expect(notificationTapTarget({ data, routeEditing: false })).toEqual({
      kind: "inbox",
    });
  });

  // The draft beats the payload, whatever the payload is. A tap that
  // navigated would leave the user in PlaceDetail with the pen still armed.
  it.each([
    ["a place push", { type: "placeShared", placeId: "c-1" }],
    ["an inbox push", { type: "friendRequest" }],
    ["an announcement push", { announcementId: "a-1" }],
    ["a malformed push", null],
  ])("refuses to leave a route being drawn, on %s", (_why, data) => {
    expect(notificationTapTarget({ data, routeEditing: true })).toEqual({
      kind: "blocked",
    });
  });

  it("blocks nothing once the route is finished", () => {
    const data = { placeId: "c-2" };
    expect(notificationTapTarget({ data, routeEditing: true }).kind).toBe(
      "blocked",
    );
    expect(notificationTapTarget({ data, routeEditing: false }).kind).toBe(
      "place",
    );
  });

  // What the API and the topo worker actually put in each push (type plus
  // opaque ids): api/src/services/push.ts and topo/push_send.py.
  const PUSH_DATA = {
    friend_request: { friendshipId: "f1" },
    friend_request_accepted: { friendshipId: "f1" },
    place_shared: { placeId: "p1" },
    item_shared: { entityType: "route", entityId: "r1" },
    file_sent: { fileSendId: "s1" },
    topo_complete: { jobId: "j1" },
    topo_failed: { jobId: "j1" },
    topo_export_complete: { exportId: "e1" },
    topo_export_skipped: {},
    egress_quota_warning: {},
    egress_quota_exceeded: {},
    announcement: { announcementId: "a1" },
    plan_invited: { planId: "pl1" },
    plan_join_request: { planId: "pl1" },
    plan_join_approved: { planId: "pl1" },
    plan_member_joined: { planId: "pl1" },
    plan_access_ended: { planId: "pl1" },
  } satisfies Record<(typeof NOTIFICATION_TYPES)[number], object>;

  // Mutation: route a push by anything but its Inbox row's destination (drop
  // the notificationDestination branch, say) and a friend or shared-item push
  // lands on the bare inbox; a new type with no PUSH_DATA does not compile.
  const KIND_OF = {
    place: "place",
    plan: "plan",
    friends: "friends",
    item: "saved",
    topo: "saved",
    // A push cannot say the send was kept, so it lands where it is answered.
    file: "inbox",
    message: "announcement",
    none: "inbox",
  } as const;

  it.each(NOTIFICATION_TYPES)(
    "sends a %s push where its Inbox row goes",
    (type) => {
      const target = notificationTapTarget({
        data: { type, ...PUSH_DATA[type] },
        routeEditing: false,
      });
      expect(target.kind).toBe(KIND_OF[NOTIFICATION_DESTINATIONS[type]]);
    },
  );

  // bulk_shared is a push-only type (no row), so the table above cannot hold it.
  it("sends a bulk share to the inbox, which lists what arrived", () => {
    expect(
      notificationTapTarget({
        data: { type: "bulk_shared", batchId: "b1" },
        routeEditing: false,
      }),
    ).toEqual({ kind: "inbox" });
  });

  // Mutation: drop the highlight key and the shared route opens its filter with
  // no row pulsed.
  it("points a shared item and a finished topo at their Saved row", () => {
    expect(
      notificationTapTarget({
        data: { type: "item_shared", entityType: "route", entityId: "r1" },
        routeEditing: false,
      }),
    ).toEqual({ kind: "saved", filter: "route", highlightKey: "r1" });
    const topo = notificationTapTarget({
      data: { type: "topo_complete", jobId: "j1" },
      routeEditing: false,
    });
    expect(topo).toMatchObject({ kind: "saved", filter: "overlay" });
    expect((topo as { highlightKey: string | null }).highlightKey).toContain(
      "j1",
    );
  });
});

// The navigator's ref is typed `never`, so these names are checked nowhere
// else. The screen names are the ones AppShell registers.
describe("an ongoing notification's tap (ongoingTap.ts)", () => {
  // Mutation: let the draft block it, and a tap on "Recording track" while a
  // route is being drawn is answered with an Alert on the very map it names.
  it("opens the map for the recording, even with a route being drawn", () => {
    expect(
      notificationTapTarget({
        data: { ongoing: "recording" },
        routeEditing: true,
      }),
    ).toEqual({ kind: "recording" });
    expect(tapTargetCall({ kind: "recording" }, 1)).toEqual({
      name: "Map",
      params: { screen: "MapView" },
    });
  });

  // Mutation: send it to the inbox, and the download notification opens a
  // screen with nothing about downloads on it.
  it("opens the offline maps in Saved for the downloads, and honours the draft", () => {
    expect(
      notificationTapTarget({
        data: { ongoing: "downloads" },
        routeEditing: false,
      }),
    ).toEqual({ kind: "saved", filter: "region", highlightKey: null });
    expect(
      notificationTapTarget({
        data: { ongoing: "downloads" },
        routeEditing: true,
      }),
    ).toEqual({ kind: "blocked" });
  });
});

describe("tapTargetCall", () => {
  // Mutation: misspell any screen name or move a param (say "Friend" for
  // "Friends", or drop `invited`), and the matching case goes red.
  it.each([
    [
      { kind: "place", placeId: "c-1" },
      {
        name: "Places",
        params: {
          screen: "PlaceDetail",
          params: { placeId: "c-1", name: "Place" },
        },
      },
    ],
    [
      { kind: "plan", planId: "p-1", view: "people", invited: false },
      {
        name: "More",
        params: {
          screen: "Plan",
          params: {
            planId: "p-1",
            name: TRIP_PLANS_LIST.title,
            view: "people",
            invited: false,
          },
        },
      },
    ],
    [
      { kind: "announcement", announcementId: "a-1" },
      {
        name: "More",
        params: {
          screen: "Inbox",
          params: { openAnnouncement: { announcementId: "a-1", nonce: 7 } },
        },
      },
    ],
    [{ kind: "friends" }, { name: "More", params: { screen: "Friends" } }],
    [
      { kind: "saved", filter: "route", highlightKey: "r1" },
      {
        name: "Saved",
        params: {
          screen: "SavedHome",
          params: { filter: "route", nonce: 7, highlightKey: "r1" },
        },
      },
    ],
    [{ kind: "inbox" }, { name: "More", params: { screen: "Inbox" } }],
  ] as const)("opens %j", (target, call) => {
    expect(tapTargetCall(target, 7)).toEqual(call);
  });

  // Mutation: always spread `highlightKey`, and a filter-only open sends
  // `highlightKey: undefined`/null, which the Saved screen reads as a row.
  it("leaves out a highlight there is none of", () => {
    expect(
      destinationCall(
        { tab: "saved", filter: "import", highlightKey: null },
        7,
      ),
    ).toEqual({
      name: "Saved",
      params: { screen: "SavedHome", params: { filter: "import", nonce: 7 } },
    });
  });
});

import { describe, expect, it } from "vitest";

import { notificationTapTarget } from "./tapTarget";

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

  it.each([
    ["a plan the recipient lost", { type: "plan_access_ended", planId: "p-1" }],
    ["no id at all", { type: "friendRequest" }],
    ["an id that is not a string", { placeId: 7 }],
    ["a null id", { placeId: null }],
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
});

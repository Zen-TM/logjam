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

  // Mutation: drop or misspell a type in PLAN_OPENING_TYPES, and that push
  // lands on the inbox.
  it.each(["plan_join_request", "plan_join_approved", "plan_member_joined"])(
    "opens the plan a %s push names",
    (type) => {
      expect(
        notificationTapTarget({
          data: { type, planId: "p-1" },
          routeEditing: false,
        }),
      ).toEqual({ kind: "plan", planId: "p-1" });
    },
  );

  // Mutation: drop the invite branch.
  it("opens the list for an invite", () => {
    expect(
      notificationTapTarget({
        data: { type: "plan_invited", planId: "p-1" },
        routeEditing: false,
      }),
    ).toEqual({ kind: "plans" });
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

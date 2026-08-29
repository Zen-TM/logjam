import { describe, expect, it } from "vitest";

import { notificationTapTarget } from "./tapTarget";

describe("notificationTapTarget", () => {
  it("opens the canyon a push names", () => {
    expect(
      notificationTapTarget({
        data: { type: "canyonShared", canyonId: "c-1" },
        routeEditing: false,
      }),
    ).toEqual({ kind: "canyon", canyonId: "c-1" });
  });

  it.each([
    ["no id at all", { type: "friendRequest" }],
    ["an id that is not a string", { canyonId: 7 }],
    ["a null id", { canyonId: null }],
    ["an empty payload", {}],
    ["a payload that is not an object", "canyonId=c-1"],
    ["no payload", undefined],
    ["a null payload", null],
  ])("falls back to the inbox on %s", (_why, data) => {
    expect(notificationTapTarget({ data, routeEditing: false })).toEqual({
      kind: "inbox",
    });
  });

  // MAPP-009: the draft beats the payload, whatever the payload is. A tap that
  // navigated would leave the user in CanyonDetail with the pen still armed.
  it.each([
    ["a canyon push", { type: "canyonShared", canyonId: "c-1" }],
    ["an inbox push", { type: "friendRequest" }],
    ["a malformed push", null],
  ])("refuses to leave a route being drawn, on %s", (_why, data) => {
    expect(notificationTapTarget({ data, routeEditing: true })).toEqual({
      kind: "blocked",
    });
  });

  it("blocks nothing once the route is finished", () => {
    const data = { canyonId: "c-2" };
    expect(notificationTapTarget({ data, routeEditing: true }).kind).toBe("blocked");
    expect(notificationTapTarget({ data, routeEditing: false }).kind).toBe("canyon");
  });
});

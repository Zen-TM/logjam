import { describe, expect, it } from "vitest";

import type { TNotification } from "../api/types";
import { notificationCanyonId, notificationMeta } from "./notificationLabel";
import { notificationHue } from "../theme";

function notification(
  type: string,
  payload: Record<string, unknown> = {},
): TNotification {
  return {
    id: "n1",
    type,
    payload,
    read: false,
    createdAt: "2026-07-30T00:00:00.000Z",
  };
}

describe("notificationMeta", () => {
  it("borrows the hue of the thing the notification is about", () => {
    // The point of the vocabulary: the same colour here and where it lives.
    expect(notificationMeta(notification("canyon_shared")).hue).toBe(notificationHue.share);
    expect(notificationMeta(notification("topo_complete")).hue).toBe(notificationHue.topo);
    expect(notificationMeta(notification("geo_pdf_complete")).hue).toBe(notificationHue.geoPdf);
    expect(notificationMeta(notification("friend_request")).kind).toBe("people");
  });

  it("classes a failure as a problem, whatever it failed at", () => {
    // Scanning an inbox is a hunt for the thing that went wrong.
    expect(notificationMeta(notification("topo_failed")).kind).toBe("problem");
    expect(
      notificationMeta(notification("topo_export_complete", { status: "failed" })).kind,
    ).toBe("problem");
    expect(
      notificationMeta(notification("geo_pdf_complete", { status: "failed" })).kind,
    ).toBe("problem");
    expect(notificationMeta(notification("topo_export_skipped")).kind).toBe("problem");
    expect(notificationMeta(notification("topo_failed")).icon).toBe("alert-triangle");
  });

  it("keeps a completion with a warning as a completion", () => {
    // A finished topo job whose OSM fetch failed still produced a map.
    const meta = notificationMeta(notification("topo_complete", { osmFailed: true }));
    expect(meta.kind).toBe("topo");
  });

  it("gives an unknown type a glyph rather than nothing", () => {
    const meta = notificationMeta(notification("something_new_from_the_server"));
    expect(meta.icon).toBeTruthy();
    expect(meta.hue).toBeTruthy();
  });
});

describe("notificationCanyonId", () => {
  it("finds the canyon a share points at", () => {
    expect(notificationCanyonId(notification("canyon_shared", { canyonId: "c1" }))).toBe("c1");
  });

  it("is null for anything without a usable id", () => {
    expect(notificationCanyonId(notification("topo_complete"))).toBeNull();
    expect(notificationCanyonId(notification("canyon_shared", { canyonId: "" }))).toBeNull();
    expect(notificationCanyonId(notification("canyon_shared", { canyonId: 7 }))).toBeNull();
  });
});

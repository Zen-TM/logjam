import { describe, expect, it } from "vitest";
import type { TNotification } from "@logjam/shared";
import { inboxDestination } from "./inboxModel";

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

  it("follows a shared item to the page that lists its kind", () => {
    expect(
      inboxDestination(notification("item_shared", { entityType: "route" })),
    ).toMatchObject({ panel: "ways" });
    expect(
      inboxDestination(
        notification("item_shared", { entityType: "somethingNew" }),
      ),
    ).toBeNull();
  });
});

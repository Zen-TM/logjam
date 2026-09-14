import { describe, expect, it } from "vitest";
import type { TNotification } from "@logjam/shared";
import { inboxDestination } from "./inboxModel";

function notification(type: string, payload: Record<string, unknown> = {}): TNotification {
  return { id: "n1", type, payload, read: false, createdAt: "2026-09-14T00:00:00.000Z" };
}

describe("inboxDestination", () => {
  it("opens the place a share is about", () => {
    expect(inboxDestination(notification("place_shared", { placeId: "p1" }))).toEqual({
      kind: "place",
      label: "Open place",
      placeId: "p1",
    });
  });

  it("sends a finished map to the Maps view that lists it", () => {
    expect(inboxDestination(notification("topo_complete", { jobId: "j1" }))).toMatchObject({ panel: "maps", mapsView: "lidar" });
    expect(inboxDestination(notification("geo_pdf_complete", { status: "completed" }))).toMatchObject({
      panel: "maps",
      mapsView: "geopdfs",
    });
  });

  it("goes nowhere for a failure, which made nothing to look at", () => {
    expect(inboxDestination(notification("geo_pdf_complete", { status: "failed" }))).toBeNull();
    expect(inboxDestination(notification("topo_export_complete", { status: "failed" }))).toBeNull();
  });

  it("goes nowhere for a file send, which the row itself answers", () => {
    expect(inboxDestination(notification("file_sent", { fileSendId: "f1" }))).toBeNull();
  });

  it("follows a shared item to the page that lists its kind", () => {
    expect(inboxDestination(notification("item_shared", { entityType: "route" }))).toMatchObject({ panel: "ways" });
    expect(inboxDestination(notification("item_shared", { entityType: "somethingNew" }))).toBeNull();
  });
});

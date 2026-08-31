// The mapping is the whole module, so the test is the table — plus the two
// rules that are easy to lose: a notification about something that does not
// exist has NO destination, and a file send only has one once it was kept.
import { describe, expect, it } from "vitest";

import type { TNotification } from "../api/types";
import { notificationDestination } from "./notificationDestination";

function notification(type: string, payload: Record<string, unknown>): TNotification {
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
    expect(notificationDestination(notification("friend_request", {}))).toEqual({
      tab: "friends",
      label: "View in Friends",
    });
    expect(
      notificationDestination(notification("friend_request_accepted", {})),
    ).toEqual({ tab: "friends", label: "View in Friends" });
  });

  it("points a shared waypoint at its own row", () => {
    expect(
      notificationDestination(
        notification("item_shared", { entityType: "waypoint", entityId: "w1" }),
      ),
    ).toEqual({
      tab: "saved",
      label: "View in Saved",
      filter: "waypoint",
      highlightKey: "w1",
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
      notificationDestination(notification("item_shared", { entityType: "waypoint" })),
    ).toBeNull();
    expect(
      notificationDestination(
        notification("item_shared", { entityType: "canyon", entityId: "c1" }),
      ),
    ).toBeNull();
  });

  it("points a finished topo at the overlay filter", () => {
    expect(
      notificationDestination(notification("topo_complete", { jobId: "j2" })),
    ).toMatchObject({ filter: "overlay", highlightKey: "overlay:j2" });
  });

  it("offers nothing for a job that produced nothing", () => {
    expect(notificationDestination(notification("topo_failed", { jobId: "j3" }))).toBeNull();
    expect(
      notificationDestination(
        notification("geo_pdf_complete", { geoPdfJobId: "g1", status: "failed" }),
      ),
    ).toBeNull();
    expect(
      notificationDestination(notification("topo_export_skipped", { reason: "x" })),
    ).toBeNull();
  });

  it("points a rendered GeoPDF at its account row", () => {
    expect(
      notificationDestination(
        notification("geo_pdf_complete", { geoPdfJobId: "g2", status: "completed" }),
      ),
    ).toMatchObject({ filter: "geoPdf", highlightKey: "g2" });
  });

  it("only points at a sent file once it has been kept, and by its kind", () => {
    expect(
      notificationDestination(
        notification("file_sent", { fileSendId: "f1", filename: "Ranon.gpx" }),
      ),
    ).toBeNull();
    expect(
      notificationDestination(
        notification("file_sent", {
          fileSendId: "f1",
          filename: "Ranon.gpx",
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
          filename: "Bell Creek.PDF",
          fileSendStatus: "accepted",
        }),
      ),
    ).toMatchObject({ filter: "geoPdf" });
  });

  it("leaves a canyon share to the sheet's own Open", () => {
    expect(
      notificationDestination(notification("canyon_shared", { canyonId: "c1" })),
    ).toBeNull();
  });
});

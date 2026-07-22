import { describe, it, expect } from "vitest";
import { notificationLabel } from "./notificationLabel";
import type { TNotification } from "../api/types";

function notification(type: string, payload: Record<string, unknown> = {}): TNotification {
  return { id: "n1", type, payload, read: false, createdAt: "2026-07-23T00:00:00.000Z" };
}

describe("notificationLabel", () => {
  it("labels friend requests with the requester username", () => {
    expect(notificationLabel(notification("friend_request", { requesterUsername: "bob" }))).toEqual({
      text: "bob sent you a friend request",
    });
  });

  it("labels accepted friend requests", () => {
    expect(
      notificationLabel(notification("friend_request_accepted", { acceptedByUsername: "carol" })),
    ).toEqual({ text: "carol accepted your friend request" });
  });

  it("labels canyon shares", () => {
    expect(
      notificationLabel(
        notification("canyon_shared", { sharedByUsername: "bob", canyonName: "Claustral" }),
      ),
    ).toEqual({ text: "bob shared Claustral with you" });
  });

  it("labels topo completion, with OSM warning when flagged", () => {
    expect(notificationLabel(notification("topo_complete", { jobName: "Kanangra" }))).toEqual({
      text: "Kanangra topo complete",
    });
    const withWarning = notificationLabel(
      notification("topo_complete", { jobName: "Kanangra", osmFailed: true }),
    );
    expect(withWarning.warning).toMatch(/OSM features unavailable/);
  });

  it("labels export completion and failure", () => {
    expect(
      notificationLabel(
        notification("topo_export_complete", { format: "pdf", jobName: "Kanangra" }),
      ).text,
    ).toBe("PDF export for Kanangra ready");
    expect(
      notificationLabel(
        notification("topo_export_complete", { status: "failed", format: "pdf", errorMessage: "boom" }),
      ),
    ).toEqual({ text: "PDF export failed", warning: "boom" });
  });

  it("labels geo_pdf completion and failure", () => {
    expect(notificationLabel(notification("geo_pdf_complete", {})).text).toBe("GeoPDF ready");
    expect(
      notificationLabel(notification("geo_pdf_complete", { status: "failed", errorMessage: "no extent" })),
    ).toEqual({ text: "GeoPDF generation failed", warning: "no extent" });
  });

  it("degrades gracefully on missing payload fields", () => {
    expect(notificationLabel(notification("friend_request")).text).toBe(
      "Someone sent you a friend request",
    );
    expect(notificationLabel(notification("canyon_shared")).text).toBe(
      "Someone shared a canyon with you",
    );
  });

  it("falls back to a generic label for unknown types", () => {
    expect(notificationLabel(notification("future_type")).text).toBe("Notification");
  });
});

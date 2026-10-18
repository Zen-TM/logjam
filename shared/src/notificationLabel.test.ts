import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_TYPES,
  notificationAnnouncement,
  notificationHaystack,
  notificationKind,
  notificationLabel,
} from "./notificationLabel.js";
import type { TNotification } from "./apiTypes.js";

function notification(
  type: string,
  payload: Record<string, unknown> = {},
): TNotification {
  return {
    id: "n1",
    type,
    payload,
    read: false,
    createdAt: "2026-07-23T00:00:00.000Z",
  };
}

describe("notificationLabel", () => {
  it("labels friend requests with the requester username", () => {
    expect(
      notificationLabel(
        notification("friend_request", { requesterUsername: "bob" }),
      ),
    ).toEqual({
      text: "bob sent you a friend request",
    });
  });

  it("labels accepted friend requests", () => {
    expect(
      notificationLabel(
        notification("friend_request_accepted", {
          acceptedByUsername: "carol",
        }),
      ),
    ).toEqual({ text: "carol accepted your friend request" });
  });

  it("labels a friend made by an invite link", () => {
    expect(
      notificationLabel(
        notification("friend_request_accepted", {
          acceptedByUsername: "carol",
          viaInvite: true,
        }),
      ),
    ).toEqual({ text: "carol used your invite link and is now a friend" });
  });

  it("labels place shares", () => {
    expect(
      notificationLabel(
        notification("place_shared", {
          sharedByUsername: "bob",
          placeName: "Claustral",
        }),
      ),
    ).toEqual({ text: "bob shared Claustral with you" });
  });

  it("labels a directly-shared item by its KIND, never by its name", () => {
    expect(
      notificationLabel(
        notification("item_shared", {
          sharedByUsername: "bob",
          entityType: "waypoint",
          entityId: "w1",
        }),
      ),
    ).toEqual({ text: "bob shared a waypoint with you" });
    expect(
      notificationLabel(
        notification("item_shared", {
          sharedByUsername: "bob",
          entityType: "topoJob",
        }),
      ).text,
    ).toBe("bob shared a LiDAR topo with you");
    // An entity type this build has never heard of still reads as a sentence
    // rather than leaking a raw enum name.
    expect(
      notificationLabel(
        notification("item_shared", {
          sharedByUsername: "bob",
          entityType: "sasquatch",
        }),
      ).text,
    ).toBe("bob shared an item with you");
  });

  it("labels topo completion, with OSM warning when flagged", () => {
    expect(
      notificationLabel(notification("topo_complete", { jobName: "Kanangra" })),
    ).toEqual({
      text: "Kanangra map ready",
    });
    const withWarning = notificationLabel(
      notification("topo_complete", { jobName: "Kanangra", osmFailed: true }),
    );
    expect(withWarning.warning).toMatch(/Roads and labels/);
  });

  it("labels export completion and failure", () => {
    expect(
      notificationLabel(
        notification("topo_export_complete", {
          format: "pdf",
          jobName: "Kanangra",
        }),
      ).text,
    ).toBe("PDF export for Kanangra ready");
    expect(
      notificationLabel(
        notification("topo_export_complete", {
          status: "failed",
          format: "pdf",
          errorMessage: "boom",
        }),
      ),
    ).toEqual({ text: "PDF export failed", warning: "boom" });
  });

  it("labels geo_pdf completion and failure", () => {
    expect(notificationLabel(notification("geo_pdf_complete", {})).text).toBe(
      "GeoPDF ready",
    );
    expect(
      notificationLabel(
        notification("geo_pdf_complete", {
          status: "failed",
          errorMessage: "no extent",
        }),
      ),
    ).toEqual({ text: "Couldn't create GeoPDF", warning: "no extent" });
  });

  it("degrades gracefully on missing payload fields", () => {
    expect(notificationLabel(notification("friend_request")).text).toBe(
      "Someone sent you a friend request",
    );
    expect(notificationLabel(notification("place_shared")).text).toBe(
      "Someone shared a place with you",
    );
  });

  it("falls back to a generic label for unknown types", () => {
    expect(notificationLabel(notification("future_type")).text).toBe(
      "Notification",
    );
  });
});

describe("announcement", () => {
  const resolved = {
    announcementId: "a1",
    title: "Trip season",
    body: "Hello **all**",
  };

  it("is labelled with the message's own title, or a generic one", () => {
    expect(notificationLabel(notification("announcement", resolved)).text).toBe(
      "Trip season",
    );
    expect(notificationLabel(notification("announcement")).text).toBe(
      "A message from the Logjam maintainer",
    );
  });

  // Red if it falls back to "people": a friends glyph reads as a friend event.
  it("is its own kind", () => {
    expect(notificationKind(notification("announcement"))).toBe("message");
  });

  it("hands a client the resolved message", () => {
    expect(
      notificationAnnouncement(notification("announcement", resolved)),
    ).toEqual({
      id: "a1",
      title: "Trip season",
      body: "Hello **all**",
    });
  });

  // Red if the helper stops checking the type or the resolved body.
  it("is null for another type or an unresolved payload", () => {
    expect(
      notificationAnnouncement(notification("topo_complete", resolved)),
    ).toBeNull();
    expect(
      notificationAnnouncement(
        notification("announcement", { announcementId: "a1" }),
      ),
    ).toBeNull();
  });
});

// A received file is the one notification whose label carries USER TEXT the
// recipient has to act on — they cannot answer "keep this?" without it.
describe("file_sent", () => {
  it("names the sender and the file", () => {
    expect(
      notificationLabel(
        notification("file_sent", {
          fileSendId: "s1",
          sentByUsername: "bob",
          filename: "Exit notes.gpx",
        }),
      ).text,
    ).toBe("bob sent you Exit notes.gpx");
  });

  it("says why a lapsed send can no longer be answered, and who to ask", () => {
    const label = notificationLabel(
      notification("file_sent", {
        fileSendId: "s1",
        sentByUsername: "bob",
        filename: "Exit notes.gpx",
        fileSendStatus: "expired",
      }),
    );
    expect(label.text).toBe("bob sent you Exit notes.gpx");
    expect(label.warning).toBe("This file expired. Ask bob to send it again.");
  });

  // Nothing to explain while it is still answerable.
  it("carries no warning while the send is still live", () => {
    for (const status of ["pending", "accepted"]) {
      expect(
        notificationLabel(
          notification("file_sent", {
            fileSendId: "s1",
            fileSendStatus: status,
          }),
        ).warning,
      ).toBeUndefined();
    }
  });

  it("degrades rather than rendering 'undefined' when neither resolves", () => {
    expect(
      notificationLabel(notification("file_sent", { fileSendId: "s1" })).text,
    ).toBe("Someone sent you a file");
  });
});

describe("notificationHaystack — what the inbox search matches", () => {
  it("matches the words the row shows, case-insensitively", () => {
    const haystack = notificationHaystack(
      notification("place_shared", {
        sharedByUsername: "bob",
        placeName: "Claustral",
      }),
    );
    expect(haystack).toContain("claustral");
    expect(haystack).toContain("bob");
  });

  it("includes the warning line, which is the only place some rows say why", () => {
    expect(
      notificationHaystack(
        notification("topo_export_skipped", {
          reason: "No layers were selected.",
        }),
      ),
    ).toContain("no layers were selected");
  });

  it("carries nothing the row does not show — no ids", () => {
    expect(
      notificationHaystack(
        notification("file_sent", { fileSendId: "abc123", filename: "x.gpx" }),
      ),
    ).not.toContain("abc123");
  });
});

// Mutation that turns this red: adding a type to NOTIFICATION_TYPES without a
// branch in notificationLabel, which would show it as the generic fallback.
describe("NOTIFICATION_TYPES", () => {
  it("has a label branch for every type", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(notificationLabel(notification(type)).text, type).not.toBe(
        "Notification",
      );
    }
  });
});

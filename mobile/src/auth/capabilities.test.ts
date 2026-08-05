import { describe, expect, it } from "vitest";

import {
  capabilityRowProps,
  capabilityStatus,
  unavailableReasonText,
  type Capability,
} from "./capabilities";

const ALL_CAPABILITIES: Capability[] = [
  "sharing",
  "friends",
  "inbox",
  "lidarOverlays",
  "accountGeoPdf",
  "vectorRegionDownload",
  "serverPrefs",
  "customFieldDefs",
  "pushNotifications",
  "syncNow",
];

describe("capabilityStatus", () => {
  it("blocks every gated capability for a guest, even online", () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(capabilityStatus(capability, "guest", true)).toEqual({
        status: "unavailable",
        reason: "needs-account",
      });
    }
  });

  // The precedence rule this whole module exists to enforce: a guest on a dead
  // connection must be told to make an account, not to find signal — connecting
  // would not unblock them.
  it("reports needs-account over needs-connection for an offline guest", () => {
    for (const capability of ALL_CAPABILITIES) {
      const result = capabilityStatus(capability, "guest", false);
      expect(result).toEqual({ status: "unavailable", reason: "needs-account" });
    }
  });

  it("allows everything for a linked user online", () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(capabilityStatus(capability, "linked", true)).toEqual({
        status: "available",
      });
    }
  });

  it("blocks connection-dependent capabilities for a linked user offline", () => {
    for (const capability of ALL_CAPABILITIES.filter((c) => c !== "inbox")) {
      expect(capabilityStatus(capability, "linked", false)).toEqual({
        status: "unavailable",
        reason: "needs-connection",
      });
    }
  });

  // The inbox is cache-first (src/sync/notificationsCache.ts), so a linked user
  // offline still gets the last fetched notifications rather than a dead row.
  it("keeps the inbox available for a linked user offline", () => {
    expect(capabilityStatus("inbox", "linked", false)).toEqual({
      status: "available",
    });
  });
});

describe("unavailableReasonText", () => {
  it("uses the canonical strings", () => {
    expect(unavailableReasonText("needs-account")).toBe("Needs an account");
    expect(unavailableReasonText("needs-connection")).toBe("Needs a connection");
  });
});

describe("capabilityRowProps", () => {
  it("omits the subtitle when available so a row keeps its own", () => {
    expect(capabilityRowProps("sharing", "linked", true)).toEqual({
      disabled: false,
    });
  });

  it("supplies the reason as the subtitle when blocked", () => {
    expect(capabilityRowProps("sharing", "guest", true)).toEqual({
      disabled: true,
      subtitle: "Needs an account",
    });
    expect(capabilityRowProps("sharing", "linked", false)).toEqual({
      disabled: true,
      subtitle: "Needs a connection",
    });
  });
});

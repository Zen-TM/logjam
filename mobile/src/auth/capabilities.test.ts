import { describe, expect, it } from "vitest";

import {
  capabilityRowProps,
  capabilityScreenBlock,
  capabilityStatus,
  fieldDefsBlockedReason,
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
  "pushNotifications",
  "syncNow",
  "offlineSettings",
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
    for (const capability of ALL_CAPABILITIES.filter(
      (c) => c !== "inbox" && c !== "offlineSettings",
    )) {
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

describe("capabilityScreenBlock", () => {
  it("blocks every gated screen for a guest, and names the reason canonically", () => {
    for (const capability of ALL_CAPABILITIES) {
      const block = capabilityScreenBlock(capability, "guest");
      expect(block?.title).toBe("Needs an account");
      expect(block?.hint).toBeTruthy();
    }
  });

  // A linked user offline keeps the screen: the inbox has a cache and Friends
  // reports the failure with a retry. Blocking them here would be a regression.
  it("never blocks a linked user, connection-dependent or not", () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(capabilityScreenBlock(capability, "linked")).toBeNull();
    }
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

// Custom fields are deliberately NOT in the union above: a guest keeps their
// own definitions on the device, so there is no account axis to gate on.
describe("fieldDefsBlockedReason", () => {
  it("never blocks a guest, online or off", () => {
    expect(fieldDefsBlockedReason("guest", true)).toBeUndefined();
    expect(fieldDefsBlockedReason("guest", false)).toBeUndefined();
  });

  it("blocks a linked user offline, because that list is shared with the web", () => {
    expect(fieldDefsBlockedReason("linked", false)).toBe("Needs a connection");
    expect(fieldDefsBlockedReason("linked", true)).toBeUndefined();
  });
});

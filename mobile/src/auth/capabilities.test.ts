import { describe, expect, it } from "vitest";

import {
  capabilityRowProps,
  capabilityScreenBlock,
  capabilityStatus,
  fieldDefsBlockedReason,
  shareCapabilityStatus,
  statusRowProps,
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
    expect(unavailableReasonText("needs-upload")).toBe("Needs to sync first");
  });
});

// The third axis, and the reason a Share verb on a route drawn in the field is
// dimmed rather than left live: there is no server row to grant access to until
// the outbox flushes, so the lookup and the grant both 404.
describe("shareCapabilityStatus", () => {
  it("is available for a linked user, online, once the row is on the server", () => {
    expect(shareCapabilityStatus("linked", true, true)).toEqual({
      status: "available",
    });
  });

  it("blocks a row the account does not hold yet", () => {
    expect(shareCapabilityStatus("linked", true, false)).toEqual({
      status: "unavailable",
      reason: "needs-upload",
    });
  });

  // PRECEDENCE, both halves of it. An offline user is told to find signal, not
  // to wait for a queue that is itself waiting on that signal — one outage, one
  // explanation, and the only one with a next step. A guest is told neither:
  // they have no account for anything to sync TO.
  it("reports needs-connection over needs-upload for an offline linked user", () => {
    expect(shareCapabilityStatus("linked", false, false)).toEqual({
      status: "unavailable",
      reason: "needs-connection",
    });
  });

  it("reports needs-account over both for a guest, however unsynced", () => {
    expect(shareCapabilityStatus("guest", true, false)).toEqual({
      status: "unavailable",
      reason: "needs-account",
    });
    expect(shareCapabilityStatus("guest", false, false)).toEqual({
      status: "unavailable",
      reason: "needs-account",
    });
  });

  // A guest's whole library is unsynced by definition, so an "on the server"
  // answer of true from a caller that did not look must not make sharing
  // available to them.
  it("still blocks a guest whose caller claims the row is on the server", () => {
    expect(shareCapabilityStatus("guest", true, true)).toEqual({
      status: "unavailable",
      reason: "needs-account",
    });
  });
});

describe("statusRowProps", () => {
  it("words every reason the same way capabilityRowProps does", () => {
    expect(statusRowProps({ status: "available" })).toEqual({ disabled: false });
    expect(
      statusRowProps(shareCapabilityStatus("linked", true, false)),
    ).toEqual({ disabled: true, subtitle: "Needs to sync first" });
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

// Custom fields are deliberately NOT in the union above, on EITHER axis:
// definitions are rows in the local mirror written through the outbox, so
// nothing about them needs an account or a connection. This test is what stops
// a gate quietly coming back — it used to block a linked user offline, when an
// account's list lived on the user record and was shared with the web.
describe("fieldDefsBlockedReason", () => {
  it("never blocks anyone, in any combination", () => {
    for (const accountState of ["guest", "linked"] as const) {
      for (const online of [true, false]) {
        expect(fieldDefsBlockedReason(accountState, online)).toBeUndefined();
      }
    }
  });
});

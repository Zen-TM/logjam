import { describe, expect, it, vi } from "vitest";
import { connectionAllowsMetered, isExpensive } from "./networkPolicy";

// The rule under test is pure; its module's two native neighbours are not.
vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: vi.fn() },
}));
vi.mock("../prefsDb", () => ({ readPref: vi.fn(), writePref: vi.fn() }));

// The regression: every metered job in the app asked `isConnectionExpensive`
// except the biggest one. `regionTileDownload.connectionAllows` gated on
// `state.type === "wifi" || "ethernet"`, so a phone tethered to another phone —
// Wi-Fi by type, mobile data by cost — pulled a whole region at full pace with
// the "Use mobile data" toggle never shown, under copy that promised the
// opposite. One rule, one function, both callers.

const wifi = {
  isConnected: true,
  type: "wifi",
  details: { isConnectionExpensive: false },
};
const hotspot = {
  isConnected: true,
  type: "wifi",
  details: { isConnectionExpensive: true },
};
const cellular = {
  isConnected: true,
  type: "cellular",
  details: { isConnectionExpensive: true },
};
const offline = { isConnected: false, type: "none", details: null };

describe("connectionAllowsMetered", () => {
  it("allows a free connection without the opt-in", () => {
    expect(connectionAllowsMetered(wifi, false)).toBe(true);
  });

  it("refuses a METERED WI-FI without the opt-in — the whole point", () => {
    expect(connectionAllowsMetered(hotspot, false)).toBe(false);
    expect(isExpensive(hotspot)).toBe(true);
  });

  it("refuses cellular without the opt-in and allows it with", () => {
    expect(connectionAllowsMetered(cellular, false)).toBe(false);
    expect(connectionAllowsMetered(cellular, true)).toBe(true);
  });

  it("refuses no connection at all, opt-in or not", () => {
    expect(connectionAllowsMetered(offline, true)).toBe(false);
  });

  it("treats an unanswerable connection as free, as the platform does", () => {
    // NetInfo omits `isConnectionExpensive` on some transports; only an
    // explicit `true` is expensive, which is what canRunNow has always done.
    expect(
      connectionAllowsMetered({ isConnected: true, type: "ethernet" }, false),
    ).toBe(true);
  });
});

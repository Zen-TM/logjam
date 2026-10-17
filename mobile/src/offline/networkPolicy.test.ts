import NetInfo from "@react-native-community/netinfo";
import { describe, expect, it, vi } from "vitest";
import { readPref } from "../prefsDb";
import {
  canRunNow,
  connectionAllowsMetered,
  connectionWorthResuming,
  isExpensive,
  isMeteredAllowed,
  meteredness,
} from "./networkPolicy";

// The rule under test is pure; its module's two native neighbours are not.
vi.mock("@react-native-community/netinfo", () => ({
  default: { fetch: vi.fn(), refresh: vi.fn() },
}));
vi.mock("../prefsDb", () => ({ readPref: vi.fn(), writePref: vi.fn() }));

// Every metered job in Logjam GPS asks `isConnectionExpensive`: a phone
// tethered to another phone is Wi-Fi by type but mobile data by cost, and
// must honor the "Use mobile data" preference. One rule, one function,
// all callers.

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
    // explicit `true` is expensive, which is what canRunNow does.
    expect(
      connectionAllowsMetered({ isConnected: true, type: "ethernet" }, false),
    ).toBe(true);
  });
});

// After airplane mode, cellular comes back before Wi-Fi. Resuming on "online
// again" would restart a Wi-Fi-only download on cellular, which pauses it again;
// connectionWorthResuming waits for an appropriate connection.
// Mutation: drop the `connectionAllowsMetered` term and the first line goes
// red; accept an unknown reachability and the last does.
describe("connectionWorthResuming", () => {
  const reachable = (state: object) => ({
    ...state,
    isInternetReachable: true,
  });

  it("is not cellular for a Wi-Fi-only job, and is the Wi-Fi after it", () => {
    expect(connectionWorthResuming(reachable(cellular), false)).toBe(false);
    expect(connectionWorthResuming(reachable(wifi), false)).toBe(true);
    expect(connectionWorthResuming(reachable(cellular), true)).toBe(true);
  });

  it("waits until the platform says the internet is there", () => {
    expect(connectionWorthResuming(reachable(offline), true)).toBe(false);
    expect(
      connectionWorthResuming({ ...wifi, isInternetReachable: null }, false),
    ).toBe(false);
  });
});

// NetInfo.fetch() answers from the last state it was SENT. Android sends none
// when it lifts the network block it puts on an app behind another app, and
// the state sent under that block calls Wi-Fi metered, so back in front a
// Wi-Fi-only job would read "mobile data" on Wi-Fi until the next real change.
// Mutation: read `NetInfo.fetch()` again and the first test goes red.
describe("canRunNow", () => {
  it("asks the platform now, not the last state NetInfo was sent", async () => {
    vi.mocked(readPref).mockReturnValue(null);
    vi.mocked(NetInfo.fetch).mockResolvedValue(hotspot as never);
    vi.mocked(NetInfo.refresh).mockResolvedValue(wifi as never);
    expect(await canRunNow("geoPdfDownload")).toBe(true);
    expect(NetInfo.fetch).not.toHaveBeenCalled();
  });

  it("refuses when the state cannot be read", async () => {
    vi.mocked(NetInfo.refresh).mockRejectedValue(new Error("no module"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await canRunNow("sync")).toBe(false);
    logged.mockRestore();
  });
});

describe("isMeteredAllowed", () => {
  // Media uploads (up to 30 MB an image, 500 MB a video) have large payload
  // sizes. The default must sit with its large siblings, not with small sync JSON.
  it("defaults every job the same way its cost class always has", () => {
    vi.mocked(readPref).mockReturnValue(null);
    expect(isMeteredAllowed("sync")).toBe(true);
    expect(isMeteredAllowed("geoPdfDownload")).toBe(false);
    expect(isMeteredAllowed("topoDownload")).toBe(false);
    expect(isMeteredAllowed("placeNames")).toBe(false);
    expect(isMeteredAllowed("mediaUpload")).toBe(false);
  });

  it("honours an explicit opt-in for the new job like every other one", () => {
    vi.mocked(readPref).mockReturnValue("on");
    expect(isMeteredAllowed("mediaUpload")).toBe(true);
  });
});

describe("meteredness", () => {
  it("reports the platform's two answers", () => {
    expect(meteredness(wifi)).toBe(false);
    expect(meteredness(hotspot)).toBe(true);
  });

  // The whole reason it exists beside isExpensive: the hard block is
  // allowed on a definite false and on nothing else, so "the platform did not
  // say" must stay distinguishable from "it said no".
  it.each([
    ["no details at all", offline],
    [
      "details without the property",
      { isConnected: true, type: "wifi", details: {} },
    ],
    [
      "a non-boolean value",
      {
        isConnected: true,
        type: "wifi",
        details: { isConnectionExpensive: "yes" },
      },
    ],
  ])("answers null on %s, where isExpensive answers false", (_label, state) => {
    expect(meteredness(state)).toBeNull();
    expect(isExpensive(state)).toBe(false);
  });
});

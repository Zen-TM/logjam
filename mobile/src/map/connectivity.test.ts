import { describe, expect, it, vi } from "vitest";
import type { NetInfoState } from "@react-native-community/netinfo";

const listeners: ((state: NetInfoState) => void)[] = [];
vi.mock("@react-native-community/netinfo", () => ({
  default: {
    addEventListener: (listener: (state: NetInfoState) => void) => {
      listeners.push(listener);
      return () => {};
    },
  },
}));

const { subscribeReconnect } = await import("./connectivity");

function emit(
  isConnected: boolean,
  isInternetReachable: boolean | null,
  type = "wifi",
): void {
  for (const listener of listeners) {
    listener({ type, isConnected, isInternetReachable } as NetInfoState);
  }
}

describe("subscribeReconnect", () => {
  it("fires on the reachability edge even while isConnected never drops", () => {
    // The Pixel 9 case: a VPN interface keeps isConnected true through an
    // outage, so only isInternetReachable tells the truth.
    const onReconnect = vi.fn();
    subscribeReconnect(onReconnect);

    emit(true, true);
    expect(onReconnect).not.toHaveBeenCalled(); // no edge: already online

    emit(true, false, "vpn"); // signal lost, interface still "connected"
    emit(true, null, "vpn"); // netinfo re-checking — not an edge either way
    expect(onReconnect).not.toHaveBeenCalled();

    emit(true, true, "vpn"); // back
    expect(onReconnect).toHaveBeenCalledTimes(1);

    emit(true, true); // steady online, no repeat
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});

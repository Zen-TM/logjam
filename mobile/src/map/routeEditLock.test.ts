import { describe, expect, it, vi } from "vitest";

import {
  announceRouteLeaveBlocked,
  onRouteLeaveBlocked,
} from "./routeEditLock";

describe("route leave blocked", () => {
  // Mutation: announce to nobody (drop the loop), and a notification tap
  // during a draw is refused in silence.
  it("tells every listener, until it unsubscribes", () => {
    const a = vi.fn();
    const off = onRouteLeaveBlocked(a);
    announceRouteLeaveBlocked();
    off();
    announceRouteLeaveBlocked();
    expect(a).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";

import { registerShellTriggers } from "./shellTriggers";

function registrars() {
  const calls: string[] = [];
  const cleanup = vi.fn();
  const arm = (name: string) => () => {
    calls.push(name);
    return cleanup;
  };
  const fns = {
    sync: arm("sync"),
    topoAutoDownload: arm("topoAutoDownload"),
    placeRegistryRefresh: arm("placeRegistryRefresh"),
  };
  return { fns, calls, cleanup };
}

describe("registerShellTriggers", () => {
  // Red if an account check is added to the place registry refresh (ADR 0034:
  // a guest gets the file with no call to our API).
  it("refreshes the place registry for a guest and for a linked install", () => {
    for (const state of ["guest", "linked"] as const) {
      const { fns, calls } = registrars();
      registerShellTriggers(state, fns);
      expect(calls).toContain("placeRegistryRefresh");
    }
  });

  // Red if a guest arms a trigger that could only 401 (ADR 0007).
  it("arms sync and the auto-download only once linked", () => {
    const guest = registrars();
    registerShellTriggers("guest", guest.fns);
    expect(guest.calls).toEqual(["placeRegistryRefresh"]);

    const linked = registrars();
    registerShellTriggers("linked", linked.fns);
    expect([...linked.calls].sort()).toEqual([
      "placeRegistryRefresh",
      "sync",
      "topoAutoDownload",
    ]);
  });

  it("tears down everything it armed", () => {
    const { fns, cleanup } = registrars();
    registerShellTriggers("linked", fns)();
    expect(cleanup).toHaveBeenCalledTimes(3);
  });
});

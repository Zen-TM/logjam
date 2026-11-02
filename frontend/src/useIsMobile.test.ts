import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsMobile } from "./useIsMobile";

// A phone's viewport, and whether it is printing, as matchMedia reports them.
let state = { narrow: true, print: false };
const listeners = new Set<() => void>();
const set = (next: Partial<typeof state>) =>
  act(() => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  });

vi.stubGlobal("matchMedia", (query: string) => ({
  get matches() {
    return query === "print" ? state.print : state.narrow;
  },
  addEventListener: (_: string, listener: () => void) =>
    listeners.add(listener),
  removeEventListener: (_: string, listener: () => void) =>
    listeners.delete(listener),
}));

afterEach(() => {
  state = { narrow: true, print: false };
});

describe("useIsMobile", () => {
  // Mutation: return the width query alone, and a phone's print is laid out
  // wide, the side panel remounts, and the plan summary prints blank.
  it("keeps a phone's answer while printing on wider paper", () => {
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
    set({ print: true, narrow: false });
    expect(result.current).toBe(true);
    set({ print: false });
    expect(result.current).toBe(false);
  });
});

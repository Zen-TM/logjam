import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useViewport } from "./useViewport";

afterEach(cleanup);

function resize(width: number, height: number) {
  act(() => {
    Object.assign(window, { innerWidth: width, innerHeight: height });
    window.dispatchEvent(new Event("resize"));
  });
}

describe("useViewport", () => {
  // Mutation: judge `short` on the current height alone and the on-screen
  // keyboard (same width, a shorter window) makes a phone's half sheet full.
  it("does not call a phone short because its keyboard opened", () => {
    resize(390, 844);
    const { result } = renderHook(useViewport);
    expect(result.current.short).toBe(false);
    resize(390, 450);
    expect(result.current.height).toBe(450);
    expect(result.current.short).toBe(false);
  });

  it("calls a window short when zoom made it so, and tall again when zoomed back", () => {
    resize(1440, 900);
    const { result } = renderHook(useViewport);
    resize(720, 450);
    expect(result.current.short).toBe(true);
    resize(1440, 900);
    expect(result.current.short).toBe(false);
  });
});

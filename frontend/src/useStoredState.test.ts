import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useStoredState } from "./useStoredState";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("useStoredState", () => {
  it("returns the default when no value is stored", () => {
    const { result } = renderHook(() => useStoredState("k", "fallback"));
    expect(result.current[0]).toBe("fallback");
  });

  it("initialises from a stored value", () => {
    localStorage.setItem("k", JSON.stringify({ a: 1 }));
    const { result } = renderHook(() => useStoredState("k", { a: 0 }));
    expect(result.current[0]).toEqual({ a: 1 });
  });

  it("persists updates to localStorage", () => {
    const { result } = renderHook(() => useStoredState("k", 0));
    act(() => result.current[1](42));
    expect(result.current[0]).toBe(42);
    expect(JSON.parse(localStorage.getItem("k")!)).toBe(42);
  });

  it("falls back to default and clears a corrupt stored value", () => {
    localStorage.setItem("k", "{not json");
    const { result } = renderHook(() => useStoredState("k", "fallback"));
    expect(result.current[0]).toBe("fallback");
    // The bad value is cleared on read, then the effect persists the default.
    expect(localStorage.getItem("k")).toBe(JSON.stringify("fallback"));
  });

  describe("storage parameter", () => {
    it("persists to sessionStorage when given, leaving localStorage untouched", () => {
      const { result } = renderHook(() => useStoredState("k", "", sessionStorage));
      act(() => result.current[1]("scrub"));
      expect(JSON.parse(sessionStorage.getItem("k")!)).toBe("scrub");
      expect(localStorage.getItem("k")).toBeNull();
    });

    it("initialises from sessionStorage when given", () => {
      sessionStorage.setItem("k", JSON.stringify("stored"));
      const { result } = renderHook(() =>
        useStoredState("k", "fallback", sessionStorage),
      );
      expect(result.current[0]).toBe("stored");
    });

    it("ignores a same-key value left in the other storage area", () => {
      // localStorage and sessionStorage are independent stores, so a value a
      // previous build wrote to localStorage under this key must not leak into
      // a session-scoped read.
      localStorage.setItem("k", JSON.stringify("stale-from-last-month"));
      const { result } = renderHook(() =>
        useStoredState("k", "fallback", sessionStorage),
      );
      expect(result.current[0]).toBe("fallback");
    });

    it("defaults to localStorage when the parameter is omitted", () => {
      const { result } = renderHook(() => useStoredState("k", ""));
      act(() => result.current[1]("pref"));
      expect(JSON.parse(localStorage.getItem("k")!)).toBe("pref");
      expect(sessionStorage.getItem("k")).toBeNull();
    });

    it("falls back to default and clears a corrupt session value", () => {
      sessionStorage.setItem("k", "{not json");
      const { result } = renderHook(() =>
        useStoredState("k", "fallback", sessionStorage),
      );
      expect(result.current[0]).toBe("fallback");
      expect(sessionStorage.getItem("k")).toBe(JSON.stringify("fallback"));
    });
  });
});

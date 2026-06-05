import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLocalStorage } from "./useLocalStorage";

beforeEach(() => {
  localStorage.clear();
});

describe("useLocalStorage", () => {
  it("returns the default when no value is stored", () => {
    const { result } = renderHook(() => useLocalStorage("k", "fallback"));
    expect(result.current[0]).toBe("fallback");
  });

  it("initialises from a stored value", () => {
    localStorage.setItem("k", JSON.stringify({ a: 1 }));
    const { result } = renderHook(() => useLocalStorage("k", { a: 0 }));
    expect(result.current[0]).toEqual({ a: 1 });
  });

  it("persists updates to localStorage", () => {
    const { result } = renderHook(() => useLocalStorage("k", 0));
    act(() => result.current[1](42));
    expect(result.current[0]).toBe(42);
    expect(JSON.parse(localStorage.getItem("k")!)).toBe(42);
  });

  it("falls back to default and clears a corrupt stored value", () => {
    localStorage.setItem("k", "{not json");
    const { result } = renderHook(() => useLocalStorage("k", "fallback"));
    expect(result.current[0]).toBe("fallback");
    // The bad value is cleared on read, then the effect persists the default.
    expect(localStorage.getItem("k")).toBe(JSON.stringify("fallback"));
  });
});

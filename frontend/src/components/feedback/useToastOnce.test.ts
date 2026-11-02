import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useToastOnce } from "./useToastOnce";

const toast = () => ({ error: vi.fn(), done: vi.fn() });

describe("useToastOnce", () => {
  // Mutation that turns it red: drop the `last.current !== message` check, and
  // a panel switch toasts the same failure again.
  it("toasts a load error once, even as the panel that says it in place comes and goes", () => {
    const t = toast();
    const { rerender } = renderHook(
      ({ message, inPlace }) => useToastOnce(message, inPlace, t),
      { initialProps: { message: "Couldn't load places.", inPlace: true } },
    );
    expect(t.error).not.toHaveBeenCalled();
    rerender({ message: "Couldn't load places.", inPlace: false });
    expect(t.error).toHaveBeenCalledTimes(1);
    rerender({ message: "Couldn't load places.", inPlace: true });
    rerender({ message: "Couldn't load places.", inPlace: false });
    expect(t.error).toHaveBeenCalledTimes(1);
  });

  it("toasts again after the error cleared", () => {
    const t = toast();
    const { rerender } = renderHook(
      ({ message }: { message: string | null }) =>
        useToastOnce(message, false, t),
      { initialProps: { message: "x" as string | null } },
    );
    rerender({ message: null });
    rerender({ message: "x" });
    expect(t.error).toHaveBeenCalledTimes(2);
  });
});

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

describe("useUnsavedChangesGuard", () => {
  it("closes immediately when not dirty", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useUnsavedChangesGuard(false, onClose));
    act(() => result.current.requestClose());
    expect(onClose).toHaveBeenCalledOnce();
    expect(result.current.guardOpen).toBe(false);
  });

  it("opens the confirm instead of closing when dirty", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useUnsavedChangesGuard(true, onClose));
    act(() => result.current.requestClose());
    expect(onClose).not.toHaveBeenCalled();
    expect(result.current.guardOpen).toBe(true);
  });

  it("confirmDiscard closes and dismisses the confirm", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useUnsavedChangesGuard(true, onClose));
    act(() => result.current.requestClose());
    act(() => result.current.confirmDiscard());
    expect(onClose).toHaveBeenCalledOnce();
    expect(result.current.guardOpen).toBe(false);
  });

  it("cancelDiscard dismisses the confirm without closing", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useUnsavedChangesGuard(true, onClose));
    act(() => result.current.requestClose());
    act(() => result.current.cancelDiscard());
    expect(onClose).not.toHaveBeenCalled();
    expect(result.current.guardOpen).toBe(false);
  });

  it("picks up a later isDirty value on the next requestClose", () => {
    const onClose = vi.fn();
    const { result, rerender } = renderHook(
      ({ dirty }) => useUnsavedChangesGuard(dirty, onClose),
      { initialProps: { dirty: false } },
    );
    rerender({ dirty: true });
    act(() => result.current.requestClose());
    expect(onClose).not.toHaveBeenCalled();
    expect(result.current.guardOpen).toBe(true);
  });
});

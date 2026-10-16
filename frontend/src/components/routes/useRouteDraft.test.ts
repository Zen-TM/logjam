import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RoutePoint } from "@logjam/shared";
import { useRouteDraft } from "./useRouteDraft";

const A: RoutePoint = [150.3, -33.7];
const B: RoutePoint = [150.31, -33.71];
const MID: RoutePoint = [150.305, -33.705];

describe("useRouteDraft undo", () => {
  // Mutation: push history in `commit` before the `updated === current` check.
  it("spends no undo step on an action that changed nothing", () => {
    const { result } = renderHook(() => useRouteDraft());
    act(() => result.current.addAnchor(A));
    act(() => result.current.addAnchor(B));
    act(() => result.current.deleteAnchorAt(9));
    act(() => result.current.undo());
    expect(result.current.points).toEqual([A]);
  });

  // Mutation: route `applySnap` through `commit`.
  it("takes back the user's click, not the snapped run that followed it", () => {
    const { result } = renderHook(() => useRouteDraft());
    act(() => result.current.addAnchor(A));
    act(() => result.current.addAnchor(B));
    act(() => result.current.applySnap(A, B, [MID]));
    expect(result.current.points).toEqual([A, MID, B]);
    act(() => result.current.undo());
    expect(result.current.points).toEqual([A]);
  });
});

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RASTER_TEMPLATE_DEFAULTS,
  type SlopeBand,
  type TUser,
} from "@logjam/shared";
import { useSlopeBands } from "./slopeBandsPreference";

const api = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("./placeUtils", () => ({ updateUserPreferences: api.update }));
const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("./components/feedback/ToastProvider", () => ({
  useToast: () => toast,
}));

const mine: SlopeBand[] = [{ fromDeg: 30, toDeg: 90, colour: "#ff0000ff" }];
const user = { uiPreferences: { slopeBands: mine } } as unknown as TUser;

beforeEach(() => {
  vi.useFakeTimers();
  api.update.mockResolvedValue(user);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useSlopeBands", () => {
  it("draws the account's bands, or the defaults before it loads", () => {
    const { result, rerender } = renderHook(
      ({ current }) => useSlopeBands(current, vi.fn()),
      { initialProps: { current: null as TUser | null } },
    );
    expect(result.current.drawn).toEqual(RASTER_TEMPLATE_DEFAULTS.slope.bands);
    rerender({ current: user });
    expect(result.current.drawn).toEqual(mine);
  });

  // Mutation: save in `setBands` itself, and dragging a colour sends a PATCH
  // per step.
  it("draws an edit at once and saves it once the user pauses", async () => {
    const apply = vi.fn();
    const { result } = renderHook(() => useSlopeBands(user, apply));
    const steps = [40, 45, 50].map((fromDeg) => [{ ...mine[0]!, fromDeg }]);
    for (const step of steps) act(() => result.current.setBands(step));
    expect(result.current.drawn).toEqual(steps[2]);
    expect(api.update).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledWith({ slopeBands: steps[2] });
    expect(apply).toHaveBeenCalledWith(user);
  });

  // Mutation: draw `bands` instead of `drawn`, and a band the editor is
  // halfway through reaches MapLibre as stops out of order.
  it("never draws or saves bands the editor would refuse", async () => {
    const { result } = renderHook(() => useSlopeBands(user, vi.fn()));
    const broken = [{ ...mine[0]!, fromDeg: 95 }];
    act(() => result.current.setBands(broken));
    expect(result.current.bands).toEqual(broken);
    expect(result.current.drawn).toEqual(mine);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.update).not.toHaveBeenCalled();
  });

  it("says when the bands could not be saved, and keeps drawing the edit", async () => {
    api.update.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useSlopeBands(user, vi.fn()));
    const edit = [{ ...mine[0]!, fromDeg: 35 }];
    act(() => result.current.setBands(edit));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(toast.error).toHaveBeenCalledWith("Couldn't save your slope bands.");
    expect(result.current.drawn).toEqual(edit);
  });
});

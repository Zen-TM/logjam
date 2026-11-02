import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TripPlanView } from "@logjam/shared";
import { ApiError } from "./errors/ApiError";
import { apiFetch } from "./placeUtils";
import { usePlan } from "./plansApi";

vi.mock("./placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./placeUtils")>()),
  apiFetch: vi.fn(),
}));

const planA = { id: "a", name: "A" } as TripPlanView;

afterEach(() => vi.mocked(apiFetch).mockReset());

describe("usePlan, one plan at a time", () => {
  // Mutation: drop the reset on a new id, and B opens on A's error page.
  it("opens another plan loading, not on the last one's error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("offline"));
    let resolveB: (plan: TripPlanView) => void = () => {};
    vi.mocked(apiFetch).mockReturnValueOnce(
      new Promise((resolve) => (resolveB = resolve)),
    );
    const { result, rerender } = renderHook(({ id }) => usePlan(id), {
      initialProps: { id: "a" as string | null },
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    rerender({ id: "b" });
    expect(result.current.error).toBeNull();
    expect(result.current.view).toBeNull();
    await act(async () => resolveB({ id: "b", name: "B" } as TripPlanView));
    expect(result.current.view?.id).toBe("b");
  });

  // Mutation: drop the reset on a new id, and a plan opened again after
  // the caller was removed shows its old page and only a toast.
  it("shows a plan opened again from nothing, its failure on the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onBackground = vi.fn();
    vi.mocked(apiFetch).mockResolvedValueOnce(planA);
    const { result, rerender } = renderHook(
      ({ id }) => usePlan(id, onBackground),
      { initialProps: { id: "a" as string | null } },
    );
    await waitFor(() => expect(result.current.view?.id).toBe("a"));
    rerender({ id: null });
    vi.mocked(apiFetch).mockRejectedValueOnce(
      new ApiError(404, "/plans/a", "GET", "Couldn't find that plan."),
    );
    rerender({ id: "a" });
    expect(result.current.view).toBeNull();
    await waitFor(() =>
      expect(result.current.error).toBe("Couldn't find that plan."),
    );
    expect(onBackground).not.toHaveBeenCalled();
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TripPlanSummary } from "@logjam/shared";
import { deletePlan, leavePlan } from "../../plansApi";
import PlansPanel from "./PlansPanel";

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("../feedback/ToastProvider", () => ({ useToast: () => toast }));
vi.mock("../../plansApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plansApi")>()),
  archivePlan: vi.fn(),
  deletePlan: vi.fn(),
  leavePlan: vi.fn(),
}));

const summary = (over: Partial<TripPlanSummary>): TripPlanSummary => ({
  id: "a",
  name: "Alpha",
  startDate: "2099-01-01",
  endDate: null,
  tripTypes: [],
  archivedAt: null,
  updatedAt: "2026-01-01T00:00:00Z",
  status: "active",
  role: "leader",
  unansweredForms: 0,
  ...over,
});

const led = summary({});
const joined = summary({ id: "b", name: "Bravo", role: "member" });

function renderList(plans: TripPlanSummary[]) {
  const onRefetch = vi.fn();
  render(
    <PlansPanel
      plans={plans}
      loaded
      error={null}
      onRefetch={onRefetch}
      onOpenPlan={() => {}}
    />,
  );
  return onRefetch;
}

Element.prototype.scrollIntoView = vi.fn();
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
    unobserve() {}
  },
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the plans list", () => {
  // Mutation: put the count back in Row's `description` (visually hidden).
  it("shows how many forms a plan is waiting on", () => {
    renderList([summary({ unansweredForms: 2 })]);
    const line = screen.getByText("2 forms to answer");
    expect(line.className).not.toContain("visually-hidden");
    expect(line.closest(".visually-hidden")).toBeNull();
  });

  // Mutation: offer the intersection of the picked plans' verbs, and a
  // led plus a joined one leaves an empty bar.
  it("deletes what you lead and leaves the rest, in one confirm", async () => {
    vi.mocked(deletePlan).mockResolvedValue(undefined as never);
    vi.mocked(leavePlan).mockResolvedValue(undefined as never);
    renderList([led, joined]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Bravo" }));
    expect(screen.queryByRole("button", { name: /^Archive/ })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete or leave the selected plans",
      }),
    );
    expect(screen.getByText("Delete 1 plan and leave 1 plan?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(leavePlan).toHaveBeenCalledWith("b", false));
    expect(deletePlan).toHaveBeenCalledWith("a");
  });

  it("offers leave alone, not dressed as a delete", () => {
    renderList([joined]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Bravo" }));
    expect(
      screen.getByRole("button", { name: "Leave the selected plans" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  // Mutation: call `clear()` after any bulk run, and the plan that failed is
  // no longer picked.
  it("keeps the plan that failed picked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(deletePlan).mockRejectedValue(new Error("no"));
    vi.mocked(leavePlan).mockResolvedValue(undefined as never);
    renderList([led, joined]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Bravo" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete or leave the selected plans",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(
      screen
        .getByRole("checkbox", { name: "Select Alpha" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
});

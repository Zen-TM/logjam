import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TRIP_PLAN_PAGE,
  TRIP_PLANS_LIST,
  type TripPlanView,
} from "@logjam/shared";

import { archivePlan } from "../../plansApi";
import PlanDetailPanel from "./PlanDetailPanel";
import PlanDetailsDialog from "./PlanDetailsDialog";
import PlanSectionDialog from "./PlanSectionDialog";

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("../feedback/ToastProvider", () => ({ useToast: () => toast }));

const plan: TripPlanView = {
  id: "p1",
  name: "Wollangambe trip",
  startDate: "2026-11-07",
  endDate: "2026-11-08",
  tripTypes: [],
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  createdBy: null,
  myRole: "leader",
  sections: [],
  members: [
    {
      user: { id: "u1", username: "alice" },
      role: "leader",
      status: "active",
    } as TripPlanView["members"][number],
    {
      user: { id: "u2", username: "bob" },
      role: "member",
      status: "active",
    } as TripPlanView["members"][number],
  ],
  places: [],
  routes: [],
  files: [],
  geoPdfs: [],
  forms: [],
};

vi.mock("../../plansApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plansApi")>()),
  usePlan: () => ({
    view: plan,
    error: null,
    refetch: vi.fn(),
    setView: vi.fn(),
  }),
  archivePlan: vi.fn(),
}));

// jsdom has no modal dialogs.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
// Nor layout: the page's view rail measures and scrolls itself.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};
// Nor the Popover API, and a closed `popover` counts as unrendered there, so
// showing one drops the attribute.
Object.assign(HTMLElement.prototype, {
  showPopover(this: HTMLElement) {
    this.removeAttribute("popover");
  },
  hidePopover() {},
  togglePopover() {},
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Edit name and dates over someone else's change", () => {
  // Mutation: drop `setValues(next.values)` in PlanDetailsDialog, and the
  // save sends the opened dates back over the other member's.
  it("sends only the user's own field after the plan was fetched again", async () => {
    const onSubmit = vi.fn(async () => {});
    const view = (
      shown: TripPlanView, // the plan as the panel now has it
    ) => (
      <PlanDetailsDialog
        open
        plan={shown}
        onSubmit={onSubmit}
        onClose={() => {}}
      />
    );
    const { rerender } = render(view(plan));
    fireEvent.change(
      screen.getByRole("textbox", { name: TRIP_PLANS_LIST.copy.name }),
      { target: { value: "Wollangambe" } },
    );
    const theirs = { ...plan, name: "Wolly", startDate: "2026-11-06" };
    rerender(view(theirs));
    fireEvent.click(
      screen.getByRole("button", { name: TRIP_PLANS_LIST.copy.save }),
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), {
      name: { from: "Wolly", to: "Wollangambe" },
    });
  });
});

describe("a section deleted while its form is open", () => {
  // Mutation: decide add or edit by whether the section is still found, and
  // Save makes the deleted section again with the typed text.
  it("is refused, never made again", () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <PlanSectionDialog
        open
        sectionId="s1"
        onSubmit={onSubmit}
        onStale={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: TRIP_PLAN_PAGE.copy.sectionSave }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(TRIP_PLAN_PAGE.copy.sectionGone)).toBeTruthy();
  });
});

describe("the plan's page after a failed write", () => {
  // Mutation: refetch the list after any archive, and one failure is said
  // twice: the archive's toast, then the list's.
  it("leaves the list alone when Archive fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(archivePlan).mockRejectedValue(new Error("offline"));
    const onPlansChanged = vi.fn();
    render(
      <PlanDetailPanel
        planId="p1"
        onBack={() => {}}
        onPlansChanged={onPlansChanged}
        onStartTripLog={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: TRIP_PLAN_PAGE.copy.actions }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onPlansChanged).not.toHaveBeenCalled();
  });
});

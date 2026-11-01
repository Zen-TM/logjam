import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SYSTEM_PLACE_TYPE_IDS,
  type TripPlanItem,
  type TripPlanPlace,
} from "@logjam/shared";
import { patchPlanItem } from "../../plansApi";
import PlanAddCopyDialog from "./PlanAddCopyDialog";
import PlanDetailsDialog from "./PlanDetailsDialog";
import PlanItemEditDialog from "./PlanItemEditDialog";
import PlanPlaceDialog from "./PlanPlaceDialog";
import type { TPlace } from "../../placeUtils";

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("../feedback/ToastProvider", () => ({ useToast: () => toast }));
vi.mock("../../plansApi", () => ({
  patchPlanItem: vi.fn(async () => undefined),
  addPlanItem: vi.fn(),
}));

// jsdom has no modal dialogs, layout or popovers.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const place = {
  kind: "place",
  id: "pl1",
  name: "Claustral",
  altNames: ["The Claustral"],
  latitude: -33.5,
  longitude: 150.25,
  elevation: 640,
  placeTypeId: SYSTEM_PLACE_TYPE_IDS.canyon,
  notes: "Exit left at the pool.",
  fieldValues: { v_grade: 3 },
  addedBy: null,
  media: [],
} as unknown as TripPlanPlace;

describe("a plan's place on Logjam Web", () => {
  // Mutation: leave notes out of PlanPlaceDialog, and what a member typed in
  // a plan's place is saved but visible nowhere.
  it("shows its notes, other names, position and attributes", () => {
    render(<PlanPlaceDialog place={place} onClose={() => {}} />);
    expect(screen.getByText("Exit left at the pool.")).toBeTruthy();
    expect(screen.getByText(/The Claustral/)).toBeTruthy();
    expect(screen.getByText("V grade")).toBeTruthy();
  });

  // Mutation: send the place's other names or position whole, and an edit
  // of one 409s over another member's edit of the other.
  it("edits its details, each compared with what is stored", async () => {
    render(
      <PlanItemEditDialog
        planId="p1"
        opened={place as TripPlanItem}
        item={place as TripPlanItem}
        onSaved={() => {}}
        onStale={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Other names"), {
      target: { value: "The Claustral, Claustral Canyon" },
    });
    fireEvent.change(screen.getByLabelText(/^Elevation/), {
      target: { value: "700" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patchPlanItem).toHaveBeenCalled());
    expect(patchPlanItem).toHaveBeenCalledWith("p1", "place", "pl1", {
      altNames: {
        from: ["The Claustral"],
        to: ["The Claustral", "Claustral Canyon"],
      },
      elevation: { from: 640, to: 700 },
    });
  });
});

describe("a plan's dates in one calendar", () => {
  // Mutation: let the second click start over, and a range can never end.
  it("the first click starts, the second ends", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<PlanDetailsDialog open onSubmit={onSubmit} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Trip" },
    });
    const month = screen.getByText(/\d{4}$/).textContent;
    expect(month).toBeTruthy();
    const days = screen.getAllByRole("button", { pressed: false });
    const pick = (n: number) =>
      fireEvent.click(days.find((b) => b.textContent === String(n))!);
    pick(10);
    pick(12);
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Make plan" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [values] = onSubmit.mock.calls[0] as unknown as [
      { startDate: string; endDate: string },
    ];
    expect(values.startDate.slice(8)).toBe("10");
    expect(values.endDate.slice(8)).toBe("12");
  });
});

describe("adding places and ways", () => {
  // Mutation: filter nothing, and a long list has no way to find one place.
  it("narrows the list by name", () => {
    const mine = (id: string, name: string) => ({ id, name }) as TPlace;
    render(
      <PlanAddCopyDialog
        planId="p1"
        places={[mine("a", "Claustral"), mine("b", "Ranon")]}
        routes={[]}
        files={[]}
        user={null}
        initial={null}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search by name" }),
      {
        target: { value: "ran" },
      },
    );
    expect(screen.queryByRole("checkbox", { name: "Claustral" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Ranon" })).toBeTruthy();
  });
});

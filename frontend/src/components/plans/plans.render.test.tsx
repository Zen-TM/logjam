import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TRIP_PLAN_FORMS,
  TRIP_PLAN_PAGE,
  tripPlanInPlanNow,
  TRIP_PLANS_LIST,
  type TripPlanFormView,
  type TripPlanView,
} from "@logjam/shared";

import { archivePlan } from "../../plansApi";
import PlanDetailPanel from "./PlanDetailPanel";
import PlanDetailsDialog from "./PlanDetailsDialog";
import PlanSectionDialog from "./PlanSectionDialog";
import PlanFormPage from "./PlanFormPage";
import PlanFormBuilderDialog from "./PlanFormBuilderDialog";

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
    // The note is under the name only: the dates were theirs alone.
    expect(
      screen.getAllByText(TRIP_PLAN_PAGE.copy.inPlanNow, { exact: false }),
    ).toHaveLength(1);
  });

  // Mutation: compare `values` with what the form opened with in `dirty`,
  // and closing a form the user never touched asks to discard changes.
  it("closes at once when only someone else changed the plan", () => {
    const onClose = vi.fn();
    const view = (shown: TripPlanView) => (
      <PlanDetailsDialog
        open
        plan={shown}
        onSubmit={async () => {}}
        onClose={onClose}
      />
    );
    const { rerender } = render(view(plan));
    rerender(view({ ...plan, name: "Wolly" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
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
        myUserId="u1"
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

const contacts: TripPlanFormView = {
  id: "f1",
  title: "Safety contacts",
  preset: null,
  questions: [{ id: "name", kind: "text", label: "Name", required: true }],
  visibleTo: "leaders",
  requiredToJoin: true,
  position: 0,
  updatedAt: "2026-10-01T00:00:00.000Z",
  myAnswer: null,
  answers: [
    {
      user: { id: "u3", username: "carol" },
      answers: { name: "Dee" },
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  ],
};

describe("a form's page, for a leader", () => {
  // Mutation: keep active members only in PlanFormPage, and a leader lets
  // carol in without seeing what she answered.
  it("shows the answers of someone asking to join, marked so", () => {
    render(
      <PlanFormPage
        form={contacts}
        role={plan.myRole}
        archived={false}
        members={[
          ...plan.members,
          {
            user: { id: "u3", username: "carol" },
            role: "member",
            status: "requested",
          } as TripPlanView["members"][number],
        ]}
        onBack={() => {}}
        onAnswer={() => {}}
        onVerb={() => {}}
      />,
    );
    const asking = screen.getByRole("region", {
      name: TRIP_PLAN_FORMS.copy.asking,
    });
    expect(asking.textContent).toContain("carol");
    expect(asking.textContent).toContain("Dee");
    expect(
      screen.getByRole("region", { name: TRIP_PLAN_FORMS.copy.answers })
        .textContent,
    ).not.toContain("carol");
  });
});

describe("Edit form over another leader's save", () => {
  // Mutation: drop the notes in PlanFormBuilderDialog, and the leader's Save
  // replaces a change they were never shown.
  it("says what the form now holds where the leader's edit stands over it", () => {
    const view = (shown: TripPlanFormView) => (
      <PlanFormBuilderDialog
        open
        form={shown}
        onSubmit={async () => {}}
        onStale={() => {}}
        onClose={() => {}}
      />
    );
    const { rerender } = render(view(contacts));
    fireEvent.change(
      screen.getByRole("textbox", { name: TRIP_PLAN_FORMS.copy.title }),
      { target: { value: "Contacts" } },
    );
    fireEvent.change(screen.getByRole("textbox", { name: /Question 1/ }), {
      target: { value: "Who to call" },
    });
    rerender(
      view({
        ...contacts,
        title: "Emergency contacts",
        questions: [{ ...contacts.questions[0], label: "Contact" }],
        updatedAt: "2026-10-02T00:00:00.000Z",
      }),
    );
    expect(
      screen.getByText(tripPlanInPlanNow("Emergency contacts")),
    ).toBeTruthy();
    expect(
      screen.getByText(TRIP_PLAN_FORMS.copy.questionsChanged),
    ).toBeTruthy();
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import {
  mediaSkippedSentence,
  TRIP_PLAN_FORMS,
  TRIP_PLAN_FORM_PRESETS,
  TRIP_PLAN_INVITE,
  TRIP_PLAN_JOIN,
  TRIP_PLAN_PAGE,
  tripPlanInPlanNow,
  TRIP_PLANS_LIST,
  type TripPlanFormView,
  type TripPlanItem,
  type TripPlanPlace,
  type TripPlanView,
} from "@logjam/shared";

import {
  addPlanItem,
  archivePlan,
  inviteMember,
  patchPlanItem,
  savePlanItem,
  previewInviteLink,
  setMemberRole,
} from "../../plansApi";
import { planInvite } from "../../pendingInvite";
import { ApiError } from "../../errors/ApiError";
import PlanDetailPanel from "./PlanDetailPanel";
import PlanDetailsDialog from "./PlanDetailsDialog";
import PlanInviteLinkDialog from "./PlanInviteLinkDialog";
import PlanJoinDialog from "./PlanJoinDialog";
import PlanInvitePage from "./PlanInvitePage";
import PlanPeople from "./PlanPeople";
import PlanSectionDialog from "./PlanSectionDialog";
import PlanFormPage from "./PlanFormPage";
import PlanFormBuilderDialog from "./PlanFormBuilderDialog";
import PlanItemEditDialog from "./PlanItemEditDialog";
import PlanAddCopyDialog from "./PlanAddCopyDialog";
import PlanTripLogPlacesDialog from "./PlanTripLogPlacesDialog";
import type { TPlace } from "../../placeUtils";

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
  addPlanItem: vi.fn(),
  patchPlanItem: vi.fn(async () => ({})),
  savePlanItem: vi.fn(),
  inviteMember: vi.fn(),
  setMemberRole: vi.fn(async () => {}),
  getInviteLinks: vi.fn(async () => []),
  previewInviteLink: vi.fn(),
}));
vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  searchUsers: async () => ({
    data: [
      { id: "u3", username: "carol" },
      { id: "u4", username: "dave" },
    ],
    total: 2,
  }),
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

/** A plan's page on `plan`, App's props stubbed; `overrides` win. */
function renderPanel(
  overrides: Partial<ComponentProps<typeof PlanDetailPanel>> = {},
) {
  return render(
    <PlanDetailPanel
      view={plan}
      error={null}
      refetch={() => {}}
      own={{ places: [], routes: [], files: [] }}
      currentUser={null}
      onOwnChanged={() => {}}
      onOpenItem={() => {}}
      copyPlaceMedia
      addCopyRequest={null}
      onAddCopyRequestConsumed={() => {}}
      onBack={() => {}}
      onPlansChanged={() => {}}
      onStartTripLog={() => {}}
      myUserId="u1"
      {...overrides}
    />,
  );
}

describe("the plan's page after a failed write", () => {
  // Mutation: refetch the list after any archive, and one failure is said
  // twice: the archive's toast, then the list's.
  it("leaves the list alone when Archive fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(archivePlan).mockRejectedValue(new Error("offline"));
    const onPlansChanged = vi.fn();
    renderPanel({ onPlansChanged });
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

describe("Invite people after a refused invite", () => {
  // Mutation: drop the quiet refetch in the catch, and a person someone
  // else just invited keeps an Invite button that fails on every press.
  it("fetches the plan again, quietly", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(inviteMember).mockRejectedValue(new Error("409"));
    const onInvited = vi.fn();
    render(
      <PlanInvitePage plan={plan} onBack={() => {}} onInvited={onInvited} />,
    );
    fireEvent.change(
      screen.getByRole("searchbox", {
        name: TRIP_PLAN_INVITE.copy.searchField,
      }),
      { target: { value: "car" } },
    );
    const [carol] = await screen.findAllByRole("button", {
      name: TRIP_PLAN_INVITE.copy.inviteSend,
    });
    fireEvent.click(carol);
    await waitFor(() =>
      expect(onInvited).toHaveBeenCalledWith({ quiet: true }),
    );
    expect(toast.error).toHaveBeenCalled();
  });

  // Mutation: one busy slot cleared by whichever write ends first, and
  // carol's Invite is live again while hers is still on its way.
  it("keeps one invite busy while another finishes", async () => {
    let send!: () => void;
    vi.mocked(inviteMember)
      .mockImplementationOnce(
        () => new Promise((done) => (send = () => done(undefined as never))),
      )
      .mockResolvedValueOnce(undefined as never);
    render(
      <PlanInvitePage plan={plan} onBack={() => {}} onInvited={() => {}} />,
    );
    fireEvent.change(
      screen.getByRole("searchbox", {
        name: TRIP_PLAN_INVITE.copy.searchField,
      }),
      { target: { value: "car" } },
    );
    const [carol, dave] = await screen.findAllByRole("button", {
      name: TRIP_PLAN_INVITE.copy.inviteSend,
    });
    fireEvent.click(carol);
    fireEvent.click(dave);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await waitFor(() => expect(dave.getAttribute("aria-busy")).toBeNull());
    expect(carol.getAttribute("aria-busy")).toBe("true");
    send();
    await waitFor(() => expect(carol.getAttribute("aria-busy")).toBeNull());
  });
});

describe("a leader stepping down on their own row", () => {
  // Mutation: run a self role change at once in PlanPeople, and one tap
  // makes alice a member with no way back by herself.
  it("asks first, naming who can make them a leader again", async () => {
    const twoLeaders = {
      ...plan,
      members: plan.members.map((member) => ({
        ...member,
        role: "leader" as const,
      })),
    };
    render(
      <PlanPeople
        plan={twoLeaders}
        myUserId="u1"
        onChanged={() => {}}
        onInvite={() => {}}
        onSeeAnswers={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Actions for alice" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Make a member/ }));
    expect(setMemberRole).not.toHaveBeenCalled();
    expect(screen.getByText(/The leader bob can\./)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Make yourself a member" }),
    );
    await waitFor(() =>
      expect(setMemberRole).toHaveBeenCalledWith("p1", "u1", "member"),
    );
  });
});

describe("a plan link opened by someone already invited", () => {
  // Mutation: send an invited preview on to the join dialog, and they are
  // told "Ask to join" but redeeming joins them at once, with no Decline.
  it("opens the plan's preview, with no Ask to join", async () => {
    vi.mocked(previewInviteLink).mockResolvedValue({
      planId: "p1",
      name: "Wollangambe trip",
      startDate: null,
      endDate: null,
      leader: { id: "u1", username: "alice" },
      requiredForms: [],
      membership: "invited",
    } as never);
    window.history.replaceState({}, "", `/#plan-invite=${"c".repeat(43)}`);
    planInvite.capture();
    const onOpenPlan = vi.fn();
    render(
      <PlanInviteLinkDialog
        enabled
        onOpenPlan={onOpenPlan}
        onShowPlans={() => {}}
      />,
    );
    await waitFor(() => expect(onOpenPlan).toHaveBeenCalledWith("p1", true));
    expect(screen.queryByText(TRIP_PLAN_JOIN.copy.askToJoin)).toBeNull();
  });
});

describe("joining a plan with Safety contacts to fill in", () => {
  // Mutation: drop `preset` from the join forms (the API's joinForms or the
  // type), and a joiner hands over a contact's phone without being told it
  // may be printed for someone not on the trip.
  it("says members may print the answers", () => {
    const contacts = TRIP_PLAN_FORM_PRESETS.safetyContacts;
    render(
      <PlanJoinDialog
        via="link"
        plan={{
          name: "Wollangambe trip",
          startDate: null,
          endDate: null,
          person: "alice",
          requiredForms: [
            {
              id: "f1",
              title: contacts.title,
              preset: "safetyContacts",
              questions: contacts.questions,
              visibleTo: "members",
              updatedAt: "2026-10-19T00:00:00.000Z",
            },
          ],
        }}
        onJoin={async () => {}}
        onStale={() => {}}
        onClose={() => {}}
      />,
    );
    expect(
      screen.getByText(/Members may print them for someone not on the trip/),
    ).toBeTruthy();
  });
});

describe("an item's edit over someone else's change", () => {
  // Mutation: drop the `adoptTheirs` step in PlanItemEditDialog, and the save
  // sends the opened name back over the one another member just wrote.
  it("sends only the user's own field, compared with what is stored", async () => {
    const stored = {
      kind: "place",
      id: "pl1",
      name: "Wollangambe",
      notes: "",
    } as TripPlanItem;
    const view = (now: TripPlanItem) => (
      <PlanItemEditDialog
        planId="p1"
        opened={stored}
        item={now}
        onSaved={() => {}}
        onStale={() => {}}
        onClose={() => {}}
      />
    );
    const { rerender } = render(view(stored));
    fireEvent.change(
      screen.getByRole("textbox", { name: TRIP_PLAN_PAGE.copy.itemNotes }),
      { target: { value: "Exit left." } },
    );
    rerender(view({ ...stored, name: "Wolly" } as TripPlanItem));
    fireEvent.click(
      screen.getByRole("button", { name: TRIP_PLAN_PAGE.copy.sectionSave }),
    );
    await waitFor(() => expect(patchPlanItem).toHaveBeenCalled());
    expect(patchPlanItem).toHaveBeenCalledWith("p1", "place", "pl1", {
      notes: { from: "", to: "Exit left." },
    });
  });
});
describe("an item's edit refused", () => {
  const way = {
    kind: "route",
    id: "r1",
    name: "Walk in",
  } as TripPlanItem;
  const view = (onStale = () => {}) => (
    <PlanItemEditDialog
      planId="p1"
      opened={way}
      item={way}
      onSaved={() => {}}
      onStale={onStale}
      onClose={() => {}}
    />
  );

  // Mutation: drop the route check, and a blank way name reaches the API,
  // which answers with a fault the user didn't make.
  it("checks a way's name before it is sent", () => {
    render(view());
    fireEvent.change(
      screen.getByRole("textbox", { name: TRIP_PLAN_PAGE.copy.itemName }),
      { target: { value: "  " } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: TRIP_PLAN_PAGE.copy.sectionSave }),
    );
    expect(screen.getByText("Name is required")).toBeTruthy();
    expect(patchPlanItem).not.toHaveBeenCalled();
  });

  // Mutation: refetch on a 409 only, and an item deleted meanwhile says
  // "Couldn't find that." on every Save, never that it went.
  it("fetches the plan again when the item went", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(patchPlanItem).mockRejectedValueOnce(
      new ApiError(404, "/plans/p1/items/route/r1", "PATCH"),
    );
    const onStale = vi.fn();
    render(view(onStale));
    fireEvent.change(
      screen.getByRole("textbox", { name: TRIP_PLAN_PAGE.copy.itemName }),
      { target: { value: "Walk out" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: TRIP_PLAN_PAGE.copy.sectionSave }),
    );
    await waitFor(() => expect(onStale).toHaveBeenCalled());
  });
});

describe("Add a copy stopped halfway", () => {
  // Mutation: drop `onAdded` from the partial failure, and the copy that
  // landed is missing from the plan until something else refetches it.
  it("says what landed and why it stopped, and shows what landed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(addPlanItem)
      .mockResolvedValueOnce({ item: {} as TripPlanItem })
      .mockRejectedValueOnce(new Error("offline"));
    const onAdded = vi.fn();
    const mine = (id: string, name: string) => ({ id, name }) as TPlace;
    render(
      <PlanAddCopyDialog
        planId="p1"
        places={[mine("a", "Claustral"), mine("b", "Ranon")]}
        routes={[]}
        files={[]}
        user={null}
        initial={null}
        onAdded={onAdded}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Claustral" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ranon" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 2 copies" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        `Added 1 of 2. ${TRIP_PLAN_PAGE.copy.addCopyFailed}`,
      ),
    );
    expect(onAdded).toHaveBeenCalled();
  });
});

describe("Start a trip log after a copy failed", () => {
  // Mutations: save every picked place again on Next, and a retry puts a
  // second copy of the first place in the user's places; drop `onStale`,
  // and a place gone from the plan 404s on every retry; count only the last
  // run's photos, and the first copy's missing photo goes unsaid.
  it("saves only the places not copied yet, then links them all", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(savePlanItem)
      .mockResolvedValueOnce({ id: "copy-a", mediaSkipped: 1 })
      .mockRejectedValueOnce(new ApiError(404, "/plans/p1", "POST"))
      .mockResolvedValueOnce({ id: "copy-b", mediaSkipped: 1 });
    const onDone = vi.fn();
    const onCopied = vi.fn();
    const onStale = vi.fn();
    const place = (id: string, name: string) =>
      ({
        kind: "place",
        id,
        name,
        placeTypeId: "canyon",
        media: [],
      }) as unknown as TripPlanPlace;
    render(
      <PlanTripLogPlacesDialog
        planId="p1"
        places={[place("a", "Claustral"), place("b", "Ranon")]}
        copyMedia
        onCopied={onCopied}
        onStale={onStale}
        onDone={onDone}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Claustral" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ranon" }));
    const next = screen.getByRole("button", {
      name: TRIP_PLAN_PAGE.copy.tripLogNext,
    });
    fireEvent.click(next);
    expect(
      await screen.findByText(/^1 copy saved to your places\./),
    ).toBeTruthy();
    expect(onCopied).toHaveBeenCalledTimes(1);
    expect(onStale).toHaveBeenCalledTimes(1);
    fireEvent.click(next);
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith(
        ["copy-a", "copy-b"],
        ["canyon", "canyon"],
      ),
    );
    expect(savePlanItem).toHaveBeenCalledTimes(3);
    expect(toast.error).toHaveBeenCalledWith(mediaSkippedSentence(2, false));
  });
});

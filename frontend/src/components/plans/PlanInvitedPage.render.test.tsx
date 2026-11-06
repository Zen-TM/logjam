import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, TRIP_PLAN_PREVIEW } from "@logjam/shared";
import { getInvitedPreview, joinPlan, leavePlan } from "../../plansApi";
import PlanInvitedPage from "./PlanInvitedPage";

vi.mock("../feedback/ToastProvider", () => ({
  useToast: () => ({ done: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../plansApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plansApi")>()),
  getInvitedPreview: vi.fn(),
  joinPlan: vi.fn(),
  leavePlan: vi.fn(),
}));

// jsdom has no modal dialogs.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

afterEach(cleanup);

describe("a username invite's page", () => {
  // Mutation: put a confirm dialog back behind Join, and the first press
  // joins nothing.
  it("joins on the first press", async () => {
    vi.mocked(getInvitedPreview).mockResolvedValue({
      id: "p1",
      name: "Wollangambe trip",
      startDate: null,
      endDate: null,
      tripTypes: [],
      invitedBy: { id: "u1", username: "mira" },
      sections: [],
      members: [],
    });
    vi.mocked(joinPlan).mockResolvedValue(undefined as never);
    const onJoined = vi.fn();
    render(
      <PlanInvitedPage
        planId="p1"
        onBack={() => {}}
        onJoined={onJoined}
        onDeclined={() => {}}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: TRIP_PLAN_PREVIEW.copy.join }),
    );
    await vi.waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(joinPlan).toHaveBeenCalledWith("p1");
  });

  // Mutation: decline on the first press, and an invite is lost to a slip.
  it("asks once before declining", async () => {
    vi.mocked(getInvitedPreview).mockResolvedValue({
      id: "p1",
      name: "Wollangambe trip",
      startDate: null,
      endDate: null,
      tripTypes: [],
      invitedBy: { id: "u1", username: "mira" },
      sections: [],
      members: [],
    });
    vi.mocked(leavePlan).mockResolvedValue(undefined as never);
    const onDeclined = vi.fn();
    render(
      <PlanInvitedPage
        planId="p1"
        onBack={() => {}}
        onJoined={() => {}}
        onDeclined={onDeclined}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: TRIP_PLAN_PREVIEW.copy.decline,
      }),
    );
    expect(leavePlan).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole("button", {
      name: TRIP_PLAN_PREVIEW.copy.decline,
    });
    fireEvent.click(buttons[buttons.length - 1]);
    await vi.waitFor(() => expect(onDeclined).toHaveBeenCalled());
  });

  // Mutation: show the generic load error (with Retry) for a 404, and an
  // invite that was withdrawn reads as a fault to try again.
  it("says the invite is gone on a 404", async () => {
    vi.mocked(getInvitedPreview).mockRejectedValue(
      new ApiError(404, "/plans/p1/preview", "GET"),
    );
    render(
      <PlanInvitedPage
        planId="p1"
        onBack={() => {}}
        onJoined={() => {}}
        onDeclined={() => {}}
      />,
    );
    expect(await screen.findByText(TRIP_PLAN_PREVIEW.copy.gone)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  // Mutation: lead with "Invited" and the inviter is only in a muted line.
  it("leads with who invited", async () => {
    vi.mocked(getInvitedPreview).mockResolvedValue({
      id: "p1",
      name: "Wollangambe trip",
      startDate: null,
      endDate: null,
      tripTypes: [],
      invitedBy: { id: "u1", username: "mira" },
      sections: [],
      members: [],
    });
    render(
      <PlanInvitedPage
        planId="p1"
        onBack={() => {}}
        onJoined={() => {}}
        onDeclined={() => {}}
      />,
    );
    expect(await screen.findByText("mira invited you")).toBeTruthy();
    expect(screen.getByText(TRIP_PLAN_PREVIEW.copy.writeUpEmpty)).toBeTruthy();
  });
});

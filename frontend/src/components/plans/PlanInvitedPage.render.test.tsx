import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TRIP_PLAN_PREVIEW } from "@logjam/shared";
import { getInvitedPreview, joinPlan, leavePlan } from "../../plansApi";
import PlanInvitedPage from "./PlanInvitedPage";

vi.mock("../feedback/ToastProvider", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
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
});

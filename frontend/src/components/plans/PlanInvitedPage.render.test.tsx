import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TRIP_PLAN_PREVIEW } from "@logjam/shared";
import { getInvitedPreview, joinPlan } from "../../plansApi";
import PlanInvitedPage from "./PlanInvitedPage";

vi.mock("../feedback/ToastProvider", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("../../plansApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plansApi")>()),
  getInvitedPreview: vi.fn(),
  joinPlan: vi.fn(),
}));

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
});

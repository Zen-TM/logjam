import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PlanFormChooser from "./PlanFormChooser";

vi.mock("../../plansApi", () => ({
  getLeaderForms: vi.fn().mockResolvedValue([
    {
      planId: "p1",
      planName: "Claustral weekend",
      formId: "f1",
      title: "Gear to borrow",
      preset: null,
      visibleTo: "members",
      questions: [{ id: "q", kind: "text", label: "Size?", required: false }],
    },
  ]),
}));

describe("the new form chooser", () => {
  it("offers a blank form, templates, and a copy under its plan's name", async () => {
    const onPick = vi.fn();
    render(<PlanFormChooser planId="p2" onPick={onPick} />);
    expect(screen.getByText("A blank form")).toBeTruthy();
    expect(screen.getByText("Trip rules")).toBeTruthy();
    expect(await screen.findByText("Claustral weekend")).toBeTruthy();
    fireEvent.click(screen.getAllByText("Gear to borrow").at(-1)!);
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Gear to borrow",
        visibleTo: "members",
      }),
    );
  });
});

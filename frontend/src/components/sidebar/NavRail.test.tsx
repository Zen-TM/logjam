import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NavRail from "./NavRail";

vi.mock("../../useIsMobile", () => ({ useIsMobile: () => false }));

afterEach(cleanup);

// Mutation that turns this red: drop the focus call from NavRail's toggle (the
// panel opens and focus stays on the rail, 9 Tabs from the panel's controls).
describe("opening a page from the rail with the keyboard", () => {
  it("moves focus into the panel", async () => {
    const open = vi.fn();
    render(
      <>
        <NavRail activePanel={null} onPanelChange={open} badgeCounts={{}} />
        <aside id="panel" tabIndex={-1} />
      </>,
    );
    // fireEvent.click leaves detail at 0, as Enter and Space do.
    fireEvent.click(screen.getByRole("button", { name: /^Places/ }));
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(document.getElementById("panel")),
    );
    expect(open).toHaveBeenCalledWith("places");
  });

  it("leaves a pointer click where it is", async () => {
    render(
      <>
        <NavRail activePanel={null} onPanelChange={() => {}} badgeCounts={{}} />
        <aside id="panel" tabIndex={-1} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Places/ }), {
      detail: 1,
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.activeElement).toBe(document.body);
  });
});

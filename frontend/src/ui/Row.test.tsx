import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Row } from "./Row";

afterEach(cleanup);

// Mutation that turns this red: drop `disabledReason` from Row (a disabled row
// goes silently grey again, with no tooltip to say why).
describe("a disabled row", () => {
  it("says why, stays focusable and does not open", () => {
    const open = vi.fn();
    render(
      <Row
        title="Coin Slot"
        onOpen={open}
        disabled
        disabledReason="Shared with you, so you can't select it"
      />,
    );
    const button = screen.getByRole("button", { name: "Coin Slot" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(open).not.toHaveBeenCalled();
    expect(
      document.getElementById(button.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("Shared with you, so you can't select it");
  });
});

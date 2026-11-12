import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FieldBeside, NumberField } from "./TextField";

afterEach(cleanup);

const field = (value: string, showError: boolean) => (
  <NumberField
    label="Latitude"
    value={value}
    onChange={() => {}}
    constraints={{ min: -90, max: 90 }}
    showError={showError}
    emptyError="Enter a latitude."
    invalidError="Latitude must be between -90 and 90."
  />
);

describe("NumberField", () => {
  // Mutation: show `emptyError` once the field is touched (a blur, such as a
  // tap on "Select on map", flashes it before any Save).
  it("says an empty field is missing on a Save attempt, never on blur", () => {
    const { rerender } = render(field("", false));
    fireEvent.blur(screen.getByLabelText("Latitude"));
    expect(screen.queryByText("Enter a latitude.")).toBeNull();
    rerender(field("", true));
    expect(screen.getByText("Enter a latitude.")).toBeTruthy();
  });

  // Mutation: drop `invalidError`, and the web says another sentence than
  // Logjam GPS under a bad number.
  it("says the caller's words under a bad number once it is left", () => {
    render(field("95", false));
    expect(screen.queryByText(/must be between/)).toBeNull();
    fireEvent.blur(screen.getByLabelText("Latitude"));
    expect(
      screen.getByText("Latitude must be between -90 and 90."),
    ).toBeTruthy();
  });
});

describe("FieldBeside", () => {
  // Mutation: render the spacer as a real label (or drop it): a screen reader
  // reads an empty label, or the button rides up to the label's line.
  it("keeps the button under an unseen, unread label-height spacer", () => {
    render(
      <FieldBeside>
        <button type="button">Select on map</button>
      </FieldBeside>,
    );
    const button = screen.getByRole("button", { name: "Select on map" });
    const spacer = button.previousElementSibling;
    expect(spacer?.getAttribute("aria-hidden")).toBe("true");
    expect(spacer?.tagName).toBe("SPAN");
  });
});

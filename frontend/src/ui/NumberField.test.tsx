import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NumberField } from "./TextField";

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

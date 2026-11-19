import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChipRail } from "./Chip";
import { Checkbox } from "./Choice";
import { FieldGroup } from "./TextField";

// jsdom has no ResizeObserver or scrollIntoView.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView = () => {};

afterEach(cleanup);

describe("FieldGroup", () => {
  // Mutation: drop `aria-describedby` from the fieldset, and a screen reader
  // hears the tick boxes without the hint and the error about them.
  it("describes its fieldset with its hint and error", () => {
    render(
      <FieldGroup label="Gear" hint="Tick what you have." error="Pick one.">
        <Checkbox label="Rope" checked={false} onChange={() => {}} />
      </FieldGroup>,
    );
    const ids = screen
      .getByRole("group", { name: "Gear" })
      .getAttribute("aria-describedby")!
      .split(" ");
    expect(ids).toEqual([
      screen.getByText("Tick what you have.").id,
      screen.getByText("Pick one.").closest("p")!.id,
    ]);
  });

  // Mutation: stop handing `describedBy` to the controls, and a named group's
  // hint and error are read by no one.
  it("hands a named group's controls the ids to describe themselves with", () => {
    render(
      <FieldGroup
        named
        label="Size"
        hint="Your usual size."
        error="Choose one."
      >
        {(describedBy) => (
          <ChipRail
            label="Size"
            options={[{ value: "s", label: "S" }]}
            value="s"
            onChange={() => {}}
            describedBy={describedBy}
          />
        )}
      </FieldGroup>,
    );
    expect(screen.queryByRole("group")).toBeNull();
    const ids = screen
      .getByRole("radiogroup", { name: "Size" })
      .getAttribute("aria-describedby")!
      .split(" ");
    expect(ids).toEqual([
      screen.getByText("Your usual size.").id,
      screen.getByText("Choose one.").closest("p")!.id,
    ]);
  });

  it("describes nothing when it has no hint or error", () => {
    render(
      <FieldGroup label="Gear">
        <Checkbox label="Rope" checked={false} onChange={() => {}} />
      </FieldGroup>,
    );
    expect(
      screen
        .getByRole("group", { name: "Gear" })
        .getAttribute("aria-describedby"),
    ).toBeNull();
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  coerceFieldValue,
  SYSTEM_FIELD_DEFS,
  type TripLogCustomFieldDef,
} from "@logjam/shared";

import CustomFieldInput from "./CustomFieldInput";

const YES_NO: TripLogCustomFieldDef = {
  key: "wetsuit",
  label: "Wetsuit",
  type: "boolean",
};

// jsdom has neither; the rail uses both to keep the chosen chip in view.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = () => {};

afterEach(cleanup);

// A checkbox has no empty state and would record `false` for an unanswered
// field — a "No" nobody gave. Unset has to render as unset and save as nothing.
describe("CustomFieldInput, a yes/no", () => {
  it("starts on — and an untouched one saves no answer", () => {
    render(<CustomFieldInput def={YES_NO} value="" onChange={() => {}} />);
    expect(
      screen.getByRole("radio", { name: "—" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(coerceFieldValue("", YES_NO.type)).toBeNull();
  });

  it("offers Yes and No as answers, and — to take one back", () => {
    const onChange = vi.fn();
    render(<CustomFieldInput def={YES_NO} value="true" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.click(screen.getByRole("radio", { name: "—" }));
    expect(onChange.mock.calls).toEqual([["false"], [""]]);
  });
});

// A labelled field (the ACA grades) is stored as a rank and read as its word:
// the pick-list shows the words and hands the form the rank.
describe("CustomFieldInput, a labelled field", () => {
  const acaWater = SYSTEM_FIELD_DEFS.find(
    (def) => def.key === "aca_water",
  ) as unknown as TripLogCustomFieldDef;

  // Mutation: map the rail's options to `{ ...option, label: option.value
  // || "—" }` in `CustomFieldInput`.
  it("offers each stop as its word and hands the form its rank", () => {
    const onChange = vi.fn();
    render(<CustomFieldInput def={acaWater} value="" onChange={onChange} />);
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "—",
      "A",
      "B",
      "C",
      "C1",
      "C2",
      "C3",
      "C4",
    ]);
    fireEvent.click(screen.getByRole("radio", { name: "C2" }));
    expect(onChange).toHaveBeenCalledWith("5");
  });

  // Mutation: hand the rail `value=""`.
  it("shows the stored rank as its word, picked", () => {
    render(<CustomFieldInput def={acaWater} value="5" onChange={() => {}} />);
    expect(
      screen.getByRole("radio", { name: "C2" }).getAttribute("aria-checked"),
    ).toBe("true");
  });
});

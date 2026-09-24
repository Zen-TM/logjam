import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { coerceFieldValue, type TripLogCustomFieldDef } from "@logjam/shared";

import CustomFieldInput from "./CustomFieldInput";

const YES_NO: TripLogCustomFieldDef = { key: "wetsuit", label: "Wetsuit", type: "boolean" };

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

// A checkbox has no empty state, so the form used to write `false` for every
// yes/no it showed — a "No" nobody gave. Unset has to render as unset and
// save as nothing.
describe("CustomFieldInput, a yes/no", () => {
  it("starts on — and an untouched one saves no answer", () => {
    render(<CustomFieldInput def={YES_NO} value="" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "—" }).getAttribute("aria-checked")).toBe("true");
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

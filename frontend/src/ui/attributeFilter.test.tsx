import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SYSTEM_FIELD_DEFS, type ScopedCustomFieldDef } from "@logjam/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttributeFilter } from "./AttributeFilter";

afterEach(cleanup);

const depth: ScopedCustomFieldDef = {
  key: "depth",
  label: "Depth",
  type: "float",
  min: 0,
  max: 1000,
  placeTypeIds: [],
  tripTypes: [],
  appliesToAllTypes: true,
} as ScopedCustomFieldDef;

// A filter that is the whole span filters nothing, so it must not be stored as
// one: the rail's tally counts what is stored.
// Mutation that turns it red: store `{ kind: "numberRange", range }` without the
// `isFullRange` check in `MinMaxFilter.commit`.
describe("a from-to filter over its whole span is no filter", () => {
  it("stores a narrower range, and null for the full one", () => {
    const onChange = vi.fn();
    render(<AttributeFilter def={depth} value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "10" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "numberRange",
      range: [10, 1000],
    });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

// A labelled field's pills read as its words, in the summary too, while the
// stored range is still of ranks.
describe("a labelled field's pills", () => {
  const acaWater = {
    ...SYSTEM_FIELD_DEFS.find((def) => def.key === "aca_water")!,
    placeTypeIds: [],
    tripTypes: [],
    appliesToAllTypes: true,
  } as ScopedCustomFieldDef;

  // Mutation: drop `word` from the pills in `AttributeFilter`.
  it("are its words, and a tap stores ranks", () => {
    const onChange = vi.fn();
    render(<AttributeFilter def={acaWater} value={null} onChange={onChange} />);
    expect(
      screen
        .getAllByRole("button", { pressed: false })
        .map((b) => b.textContent),
    ).toEqual(["A", "B", "C", "C1", "C2", "C3", "C4"]);
    fireEvent.click(screen.getByRole("button", { name: "C2" }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "numberRange",
      range: [5, 5],
    });
  });

  // Mutation: format the summary with numbers.
  it("name the chosen span in words", () => {
    render(
      <AttributeFilter
        def={acaWater}
        value={{ kind: "numberRange", range: [2, 5] }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("B–C2")).toBeTruthy();
  });
});

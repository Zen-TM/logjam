import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ScopedCustomFieldDef } from "@logjam/shared";
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

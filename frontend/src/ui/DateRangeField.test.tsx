import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateRangeField } from "./DateRangeField";

const labels = {
  none: "No dates",
  clear: "Clear dates",
  prevMonth: "Earlier month",
  nextMonth: "Later month",
};
const day = (key: string) =>
  screen.getByRole("button", {
    name: new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, {
      dateStyle: "full",
      timeZone: "UTC",
    }),
  });

afterEach(cleanup);

describe("the date range calendar", () => {
  // Mutation: let an earlier tap swap into a range, and the second tap here
  // keeps 2026-11-07 as the end.
  it("starts, ends, and starts over on an earlier day", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DateRangeField
        label="Dates"
        labels={labels}
        start="2026-11-07"
        end={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(day("2026-11-09"));
    expect(onChange).toHaveBeenLastCalledWith("2026-11-07", "2026-11-09");
    fireEvent.click(day("2026-11-03"));
    expect(onChange).toHaveBeenLastCalledWith("2026-11-03", null);
    rerender(
      <DateRangeField
        label="Dates"
        labels={labels}
        start="2026-11-07"
        end="2026-11-09"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: labels.clear }));
    expect(onChange).toHaveBeenLastCalledWith(null, null);
  });

  it("says its own words from the labels it is given", () => {
    render(
      <DateRangeField
        label="Dates"
        labels={labels}
        start={null}
        end={null}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(labels.none)).toBeTruthy();
    expect(screen.getByRole("button", { name: labels.nextMonth })).toBeTruthy();
  });
});

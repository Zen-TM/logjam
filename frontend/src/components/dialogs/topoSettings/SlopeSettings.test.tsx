import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RASTER_TEMPLATE_DEFAULTS } from "@logjam/shared";
import SlopeSettings from "./SlopeSettings";

afterEach(cleanup);

const bands = RASTER_TEMPLATE_DEFAULTS.slope.bands; // 40-50 is the first band

function draw() {
  const onChange = vi.fn();
  render(
    <SlopeSettings value={{ enabled: true, bands }} onChange={onChange} />,
  );
  return onChange;
}

describe("a slope angle the bands cannot take", () => {
  // Mutation: drop `explain` from the slope fields, and the box snaps back to
  // the angle in force on leaving it, with nothing said.
  it("is put back and still says why", () => {
    const onChange = draw();
    const upper = screen.getByLabelText("Band 1 upper angle in degrees");
    fireEvent.change(upper, { target: { value: "5" } });
    fireEvent.blur(upper);
    expect(upper).toHaveProperty("value", "50");
    expect(screen.getByText("Use a whole number from 41 to 59.")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears the reason at the next keystroke", () => {
    draw();
    const upper = screen.getByLabelText("Band 1 upper angle in degrees");
    fireEvent.change(upper, { target: { value: "5" } });
    fireEvent.blur(upper);
    fireEvent.change(upper, { target: { value: "55" } });
    expect(screen.queryByText(/Use a whole number/)).toBeNull();
  });
});

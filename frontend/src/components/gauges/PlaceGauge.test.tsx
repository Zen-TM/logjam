import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAUGES, PLACE_PAGE } from "@logjam/shared";
import latestJson from "../../../../shared/src/__fixtures__/gauges-latest.json";
import { PlaceGauge } from "./PlaceGauge";

const place = { latitude: -33.5, longitude: 150.3 };
const draw = (over: Partial<Parameters<typeof PlaceGauge>[0]>) => {
  const onChange = vi.fn();
  render(
    <PlaceGauge
      {...place}
      gaugeId={null}
      owned
      tripDates={[]}
      onChange={onChange}
      {...over}
    />,
  );
  return onChange;
};

beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json(latestJson))),
  ),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a place's river gauge", () => {
  // Mutation: call onChange with the nearest gauge when the list opens.
  it("lists nearby gauges to choose from and preselects none", async () => {
    const onChange = draw({});
    fireEvent.click(screen.getByText(PLACE_PAGE.copy.chooseGauge));
    await screen.findByText(PLACE_PAGE.copy.gaugePickerHint);
    expect(screen.getAllByRole("button").length).toBeGreaterThan(1);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Made Up Creek at Two"));
    expect(onChange).toHaveBeenCalledWith("900002");
  });

  // Mutation: draw the picker row for a sharee.
  it("shows a sharee the reading and no way to change it", async () => {
    draw({ owned: false, gaugeId: "900001" });
    await screen.findByText("Made Up River at One");
    expect(screen.queryByText(PLACE_PAGE.copy.changeGauge)).toBeNull();
    expect(screen.queryByText(PLACE_PAGE.copy.removeGauge)).toBeNull();
  });

  // Mutation: gate the picker on `file` alone, and a failed load leaves the
  // owner with no rows and no way back.
  it("says a failed load in the picker and lets the owner cancel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    draw({});
    fireEvent.click(screen.getByText(PLACE_PAGE.copy.chooseGauge));
    await screen.findByText(GAUGES.copy.failed);
    fireEvent.click(screen.getByText(PLACE_PAGE.copy.cancelPick));
    expect(screen.getByText(PLACE_PAGE.copy.chooseGauge)).toBeTruthy();
  });

  it("lets the owner remove the gauge", async () => {
    const onChange = draw({ gaugeId: "900001" });
    fireEvent.click(await screen.findByText(PLACE_PAGE.copy.removeGauge));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

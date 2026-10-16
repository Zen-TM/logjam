import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MapSearchBox from "./MapSearchBox";

const { geocode } = vi.hoisted(() => ({ geocode: vi.fn(async () => []) }));
vi.mock("@logjam/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@logjam/shared")>()),
  geocode,
}));

afterEach(() => {
  cleanup();
  geocode.mockClear();
});

describe("MapSearchBox", () => {
  // Mutation: start the geocode effect from the query instead of from
  // `locationQuery`, which only "Search locations for …" sets.
  it("sends a query to the public geocoder only when the user asks it to", () => {
    render(
      <MapSearchBox
        places={[]}
        sharedPlaces={[]}
        onSelectPlace={() => {}}
        onSelectLocation={() => {}}
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    for (const typed of ["Hi", "Hidden", "Hidden Gorge"]) {
      fireEvent.change(input, { target: { value: typed } });
    }
    expect(geocode).not.toHaveBeenCalled();

    fireEvent.pointerDown(
      screen.getByRole("option", { name: /Search locations for/ }),
    );
    expect(geocode).toHaveBeenCalledOnce();
    expect(geocode).toHaveBeenCalledWith("Hidden Gorge", expect.anything());
  });
});

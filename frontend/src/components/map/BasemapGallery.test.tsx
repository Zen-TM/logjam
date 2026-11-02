import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import BasemapGallery, { type BaseLayer } from "./BasemapGallery";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const layers: BaseLayer[] = [
  { id: "protomaps", name: "OSM Vector", tiles: [], maxzoom: 15 },
  {
    id: "six-topo",
    name: "SIX Topo",
    tiles: ["https://six.example/{z}/{x}/{y}.png"],
    maxzoom: 16,
  },
];
const view = { lng: 150.3, lat: -33.7, zoom: 13 };

function draw(unavailable?: ReadonlySet<string>, onHealth = vi.fn()) {
  const onChange = vi.fn();
  const { container } = render(
    <BasemapGallery
      label="Map"
      layers={layers}
      activeLayerId="protomaps"
      onChange={onChange}
      mapView={view}
      unavailable={unavailable}
      onHealth={onHealth}
    />,
  );
  return { container, onChange, onHealth };
}

describe("BasemapGallery", () => {
  // Mutation: give the vector swatch no tile, and it stays one picture however
  // the map moves.
  it("draws the vector swatch from a tile of the current view", () => {
    const { container } = draw();
    const src = container.querySelectorAll("img")[0].getAttribute("src");
    expect(src).toContain("tile.openstreetmap.org/13/");
  });

  // Mutation: report the lookalike's failure as the vector basemap down, and
  // an OSM outage disables our own archive.
  it("a failed vector swatch falls back to the drawing, not to unavailable", () => {
    const { container, onHealth } = draw();
    fireEvent.error(container.querySelectorAll("img")[0]);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(onHealth).not.toHaveBeenCalled();
  });

  // Mutation: drop the onError wiring, and a dead server's swatch is a broken
  // image that can still be picked.
  it("reports a failed raster swatch whose server does not answer, and a loaded one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 503 }));
    const { container, onHealth } = draw();
    const raster = container.querySelectorAll("img")[1];
    fireEvent.error(raster);
    await waitFor(() =>
      expect(onHealth).toHaveBeenLastCalledWith("six-topo", true),
    );
    fireEvent.load(raster);
    expect(onHealth).toHaveBeenLastCalledWith("six-topo", false);
  });

  // Mutation: mark down on the img error alone (skip serverAnswers), and SIX
  // outside NSW (a 404 tile) greys out a healthy basemap.
  it("does not mark a basemap down when the server answers 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 404 });
    vi.stubGlobal("fetch", fetchMock);
    const { container, onHealth } = draw();
    fireEvent.error(container.querySelectorAll("img")[1]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(onHealth).not.toHaveBeenCalled();
  });

  // Mutation: key the tab stop on the active index alone, and with the active
  // basemap down (disabled) nothing in the group can be tabbed to.
  it("moves the tab stop to the first enabled tile when the active one is down", () => {
    draw(new Set(["protomaps"]));
    const tabs = screen
      .getAllByRole("radio")
      .map((tile) => tile.getAttribute("tabindex"));
    expect(tabs).toEqual(["-1", "0"]);
  });

  // Mutation: pass `unavailable` to nextEnabledIndex as all-false, and the
  // arrow lands on a down tile.
  it("arrow keys skip a down tile", () => {
    const three = [
      ...layers,
      {
        id: "osm",
        name: "OSM",
        tiles: ["https://o.example/{z}/{x}/{y}.png"],
        maxzoom: 19,
      },
    ];
    const onChange = vi.fn();
    render(
      <BasemapGallery
        label="Map"
        layers={three}
        activeLayerId="protomaps"
        onChange={onChange}
        mapView={view}
        unavailable={new Set(["six-topo"])}
      />,
    );
    screen.getAllByRole("radio")[0].focus();
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("osm");
  });

  // Mutation: drop `disabled`, and a down basemap can be selected.
  it("shows a down basemap as not available and cannot be picked", () => {
    const { onChange } = draw(new Set(["six-topo"]));
    expect(screen.getByText("Not available right now")).toBeTruthy();
    const tile = screen.getByRole("radio", { name: /SIX Topo/ });
    expect((tile as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(tile);
    expect(onChange).not.toHaveBeenCalled();
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  lat2tileY,
  lon2tileX,
  type SharpenedArea,
  AREA_EXPORT_TOO_LARGE,
  GEOPDF_TOO_LARGE,
  MAP_TERRAIN,
  TERRAIN_LAYER_DEFAULTS,
} from "@logjam/shared";
import { apiFetch } from "../../placeUtils";
import GeoPdfDialog from "./GeoPdfDialog";
import { GEOPDF_SETTINGS_KEY } from "./geoPdfSettings";
import type { TBbox } from "../map/Map";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import { ToastProvider } from "../feedback/ToastProvider";

vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  apiFetch: vi.fn(async () => ({})),
}));

// Map.tsx pulls in maplibre and a Vite virtual module; the dialog reads only
// its base-layer list.
vi.mock("../map/Map", () => ({
  BASE_LAYERS: [
    { id: "six-topo", name: "Topo", kind: "raster", tiles: [] },
    { id: "six-imagery", name: "Imagery", kind: "raster", tiles: [] },
  ],
}));

// jsdom has no matchMedia, ResizeObserver, scrollIntoView or modal <dialog>.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = () => {};
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
}));
HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.mocked(apiFetch).mockClear();
});

function dialog({
  open,
  onSelectOnMap = () => {},
  ...props
}: {
  open: boolean;
  onSelectOnMap?: (...args: unknown[]) => void;
  pendingExtent?: TBbox | null;
  pendingScale?: number | null;
  completedTopoJobs?: CompletedTopoJob[];
  areaSeed?: TBbox | null;
  openWithGis?: boolean;
  sharpenedAreas?: SharpenedArea[];
  onPickArea?: () => void;
  pendingArea?: TBbox | null;
  terrainLayers?: typeof TERRAIN_LAYER_DEFAULTS;
}) {
  return (
    <ToastProvider>
      <GeoPdfDialog
        open={open}
        onClose={() => {}}
        onSelectOnMap={onSelectOnMap}
        pendingExtent={null}
        pendingScale={null}
        activeLayerId="six-topo"
        terrainLayers={TERRAIN_LAYER_DEFAULTS}
        completedTopoJobs={[]}
        {...props}
      />
    </ToastProvider>
  );
}

// The form is filled once per genuine open. "Select on map" closes the dialog
// and reopens it, which is not a new open: edits made before the pick must
// survive it. Mutation: drop the `seededView` gate around the open-time seed.
describe("GeoPdfDialog, across a Select on map round trip", () => {
  it("keeps edits made before the pick", async () => {
    let selectOnMap = () => {};
    const props = { onSelectOnMap: () => selectOnMap() };
    localStorage.setItem(
      GEOPDF_SETTINGS_KEY,
      JSON.stringify({ paperSize: "A3" }),
    );
    const { rerender } = render(dialog({ open: true, ...props }));
    fireEvent.click(screen.getByRole("radio", { name: "A5" }));

    selectOnMap = () => rerender(dialog({ open: false, ...props }));
    fireEvent.click(screen.getByRole("button", { name: "Pick on the map" }));
    rerender(dialog({ open: true, ...props }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(paper("A5").ariaChecked).toBe("true");
  });
});

const paper = (name: string) => screen.getByRole("radio", { name });
const extent: TBbox = { north: -33.6, south: -33.7, east: 150.3, west: 150.2 };
const posted = () =>
  vi
    .mocked(apiFetch)
    .mock.calls.filter(([path]) => path === "/geo-pdf")
    .map(([, init]) => (init as { body: unknown }).body);

// The last settings come back, and only they. Mutations: store the whole
// config (the title and extent land in localStorage); stop reading it back on
// open.
describe("GeoPdfDialog, remembers the last settings", () => {
  async function makeOne() {
    render(dialog({ open: true, pendingExtent: extent, pendingScale: 50000 }));
    fireEvent.click(paper("A3"));
    fireEvent.click(paper("Landscape"));
    fireEvent.click(paper("Imagery"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Scale bar" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Title" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Map title" }), {
      target: { value: "Secret Gorge" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Make it" }));
    await vi.waitFor(() =>
      expect(localStorage.getItem(GEOPDF_SETTINGS_KEY)).not.toBe("null"),
    );
    expect(posted()).toHaveLength(1);
    cleanup();
  }

  it("opens on them after a GeoPDF is made", async () => {
    await makeOne();
    render(dialog({ open: true }));
    expect(paper("A3").ariaChecked).toBe("true");
    expect(paper("Landscape").ariaChecked).toBe("true");
    expect(paper("Imagery").ariaChecked).toBe("true");
    expect(
      (screen.getByRole("checkbox", { name: "Scale bar" }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    // The scale is part of them, the title and area are not.
    expect(paper("1:50,000").ariaChecked).toBe("true");
    expect(screen.queryByRole("textbox", { name: "Map title" })).toBeNull();
  });

  it("never stores the title or the area", async () => {
    await makeOne();
    const json = localStorage.getItem(GEOPDF_SETTINGS_KEY)!;
    expect(json).toBeTruthy();
    for (const secret of ["Secret", "33.6", "150.2", "extent", "title"])
      expect(json).not.toContain(secret);
  });

  it("falls back to the defaults for a value that no longer validates", () => {
    localStorage.setItem(
      GEOPDF_SETTINGS_KEY,
      JSON.stringify({ paperSize: "A0", orientation: "landscape", scale: "x" }),
    );
    render(dialog({ open: true }));
    expect(paper("A4").ariaChecked).toBe("true");
    expect(paper("Landscape").ariaChecked).toBe("true");
    expect(paper("1:25,000").ariaChecked).toBe("true");
  });

  it("opens on the defaults when what is stored is not JSON", () => {
    localStorage.setItem(GEOPDF_SETTINGS_KEY, "{oops");
    render(dialog({ open: true }));
    expect(paper("A4").ariaChecked).toBe("true");
  });
});

// "Pick on the map" opens the map on the base layer chosen HERE, so the
// frame sits on what will be printed (shared/DESIGN.md §11), and the latest
// pick wins on every visit. App holds it only for the length of the framing and
// never writes the user's own layer (`geoPdfFraming.test.ts`).
//
// Mutation: stop passing `selectedBaseLayer` as the fifth argument, or pass the
// `activeLayerId` prop instead.
describe("GeoPdfDialog, drawing the area", () => {
  it("hands the map the base layer chosen in the dialog, each visit", () => {
    const handed: unknown[] = [];
    render(
      dialog({
        open: true,
        onSelectOnMap: (...args) => handed.push(args[4]),
      }),
    );
    const draw = () =>
      fireEvent.click(screen.getByRole("button", { name: "Pick on the map" }));

    // Seeded from the map's own layer, until something else is picked.
    draw();
    fireEvent.click(screen.getByRole("radio", { name: "Imagery" }));
    draw();
    fireEvent.click(screen.getByRole("radio", { name: "Topo" }));
    draw();

    expect(handed).toEqual(["six-topo", "six-imagery", "six-topo"]);
  });
});

const edges = () =>
  screen.getByText("Exact edges").closest("details") as HTMLDetailsElement;

// Coordinates, the lock, the edges and the pivot wait behind Exact edges,
// which starts closed; Make it opens it when a field inside needs fixing, or
// the banner would point at a field nobody can see. With no map centre the
// seeded extent is all zeros, so North is not above South. Mutation: drop
// `setEdgesOpen(true)` from handleGenerate.
describe("GeoPdfDialog, Exact edges", () => {
  it("starts closed and opens on Make it when an edge needs fixing", () => {
    render(dialog({ open: true }));
    expect(edges().open).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Make it" }));

    expect(edges().open).toBe(true);
    expect(screen.getByText("A field below needs fixing first.")).toBeTruthy();
  });
});

// The NSW series are chips; Other opens the typed field. The scale picked
// is the one the map frames at. Mutations: stop applying a preset's scale;
// show the field for a preset.
describe("GeoPdfDialog, scale", () => {
  it("frames at the preset picked, and types any other under Other", () => {
    const scales: unknown[] = [];
    render(
      dialog({
        open: true,
        onSelectOnMap: (...args) => scales.push(args[3]),
      }),
    );
    const pick = () =>
      fireEvent.click(screen.getByRole("button", { name: "Pick on the map" }));
    const scaleField = () => screen.queryByRole("textbox", { name: "Scale" });

    expect(screen.getByRole("radio", { name: /^1:25.000$/ }).ariaChecked).toBe(
      "true",
    );
    expect(scaleField()).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /^1:50.000$/ }));
    pick();
    expect(scales).toEqual([50000]);

    fireEvent.click(screen.getByRole("radio", { name: "Other" }));
    const field = scaleField() as HTMLInputElement;
    expect(field.value).toBe("50000");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "12500" } });
    fireEvent.blur(field);
    pick();
    expect(scales).toEqual([50000, 12500]);
  });
});

// The renderer's limit, shown under the area as soon as it is passed, in the
// sentence the API would answer with. A 1° square at 1:25 000 is far past it.
// Mutation: drop `tooLarge` from the FieldError or from handleGenerate's check.
describe("GeoPdfDialog, a map too large to draw", () => {
  const box = (size: number): TBbox => ({
    north: -33.7,
    south: -33.7 - size,
    east: 150.3 + size,
    west: 150.3,
  });

  it("says so under the area, and Make it points there", () => {
    render(dialog({ open: true, pendingExtent: box(1), pendingScale: 25000 }));
    expect(screen.getByText(GEOPDF_TOO_LARGE)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Make it" }));
    expect(screen.getByText("A field below needs fixing first.")).toBeTruthy();
  });

  it("says nothing for an ordinary sheet", () => {
    render(
      dialog({ open: true, pendingExtent: box(0.05), pendingScale: 25000 }),
    );
    expect(screen.queryByText(GEOPDF_TOO_LARGE)).toBeNull();
  });
});

// The statewide contours stay off a sheet that prints its own, as on the map,
// so with no LiDAR job in the area the switch could draw nothing. Mutation:
// drop the `printed` gate from the Contours checkbox.
describe("GeoPdfDialog, the Terrain layers", () => {
  const contours = () =>
    screen.getByRole("checkbox", { name: /Contours/ }) as HTMLInputElement;

  it("offers contours over imagery, and says the topo sheet prints its own", () => {
    render(dialog({ open: true }));
    expect(contours().disabled).toBe(true);
    expect(screen.getByText("This map prints its own")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Imagery" }));
    expect(contours().disabled).toBe(false);
    expect(contours().checked).toBe(true);
  });

  // Mutation: drop `shadowed` from the Hillshade checkbox (it stays ticked and
  // enabled over photographs), or drop the `.filter` on submit (a hillshade
  // chosen on the topo sheet is still sent over imagery).
  it("keeps hillshade off imagery: disabled, unticked, and not sent", async () => {
    vi.mocked(apiFetch).mockClear();
    render(
      dialog({
        open: true,
        pendingExtent: {
          north: -33.7,
          south: -33.75,
          east: 150.35,
          west: 150.3,
        },
        pendingScale: 25000,
        terrainLayers: { ...TERRAIN_LAYER_DEFAULTS, hillshade: true },
      }),
    );
    const hillshade = () =>
      screen.getByRole("checkbox", { name: /Hillshade/ }) as HTMLInputElement;
    expect(hillshade().disabled).toBe(false);
    expect(hillshade().checked).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "Imagery" }));
    expect(hillshade().disabled).toBe(true);
    expect(hillshade().checked).toBe(false);
    expect(screen.getByText(MAP_TERRAIN.copy.hillshadeImagery)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Make it" }));
    await vi.waitFor(() => {
      const post = vi
        .mocked(apiFetch)
        .mock.calls.find(([path]) => path === "/geo-pdf");
      expect(post).toBeTruthy();
      const body = (post![1] as { body: { overlays: string[] } }).body;
      expect(body.overlays).not.toContain("hillshade");
    });
  });
});

// Over a job of the user's, the Terrain boxes turn on, so the job's own slope
// and shading print as they did before; once the user ticks one, the box keeps
// their choice. Mutation: leave `setTerrainFollowsMap(false)` out of
// toggleOverlay, and the unticked Slope comes back over the job.
describe("GeoPdfDialog, the Terrain layers over a LiDAR job", () => {
  const job = {
    syncRole: "owner",
    footprint: {
      type: "Polygon",
      coordinates: [
        [
          [150.31, -33.75],
          [150.33, -33.75],
          [150.33, -33.71],
          [150.31, -33.75],
        ],
      ],
    },
  } as CompletedTopoJob;
  const overJob: TBbox = {
    north: -33.7,
    south: -33.76,
    east: 150.36,
    west: 150.3,
  };
  const away: TBbox = {
    north: -33.9,
    south: -33.96,
    east: 150.36,
    west: 150.3,
  };
  const hillshade = () =>
    screen.getByRole("checkbox", { name: /^Hillshade/ }) as HTMLInputElement;
  const at = (pendingExtent: TBbox) =>
    dialog({
      open: true,
      completedTopoJobs: [job],
      pendingExtent,
      pendingScale: 25000,
    });

  it("follows the area until the user chooses", () => {
    const { rerender } = render(at(away));
    expect(hillshade().checked).toBe(false);
    rerender(at(overJob));
    expect(hillshade().checked).toBe(true);

    fireEvent.click(hillshade());
    rerender(at(away));
    rerender(at(overJob));
    expect(hillshade().checked).toBe(false);
  });
});

const seed: TBbox = { north: -33.6, south: -33.7, east: 150.3, west: 150.2 };

function chooseGis(format: "GeoTIFF" | "GeoPackage" | "MBTiles") {
  const forGis = screen.getByText("For GIS").closest("details")!;
  forGis.open = true;
  fireEvent.click(screen.getByRole("radio", { name: format }));
}

const exportPosts = () =>
  vi
    .mocked(apiFetch)
    .mock.calls.filter(([path]) => path === "/topo-exports")
    .map(([, init]) => (init as { body: unknown }).body);

describe("Export an area, for GIS", () => {
  // Mutation: start `format` at a GIS format, or `gisOpen` at true.
  it("opens on GeoPDF with For GIS closed", () => {
    render(dialog({ open: true }));
    expect(
      screen
        .getByRole("radio", { name: "GeoPDF" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByText("For GIS").closest("details")!.open).toBe(false);
  });

  // The choice spans two groups, so neither may claim the whole of it: with
  // a GIS format chosen, a screen reader would hear "Format" with nothing
  // checked. Mutation: name the GeoPDF group "Format" again.
  it("names the GeoPDF group for what it holds, beside For GIS", () => {
    render(dialog({ open: true }));
    const print = screen.getByRole("radiogroup", { name: "For print" });
    expect(within(print).getByRole("radio", { name: "GeoPDF" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "For GIS" })).toBeTruthy();
  });

  // A GIS file is a free box: no paper, and only the layers the format holds.
  // Mutation: render the GeoPDF body whatever the format, or list every layer.
  it("drops the paper and offers only the format's layers", () => {
    render(dialog({ open: true, areaSeed: seed }));
    chooseGis("GeoTIFF");
    expect(screen.queryByRole("radiogroup", { name: "Paper size" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Heights" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Contours" })).toBeNull();

    chooseGis("MBTiles");
    expect(screen.queryByRole("checkbox", { name: "Heights" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Contours" })).toBeTruthy();
  });

  // Mutation: post the GeoPDF's extent instead of the box, or send a layer
  // that is unticked.
  it("sends the box it was opened over, the ticked layers and the format", async () => {
    vi.mocked(apiFetch).mockClear();
    render(dialog({ open: true, areaSeed: seed }));
    chooseGis("GeoPackage");
    fireEvent.click(screen.getByRole("checkbox", { name: "Heights" }));
    fireEvent.click(screen.getByRole("button", { name: "Make it" }));

    await vi.waitFor(() =>
      expect(exportPosts()).toEqual([
        {
          bbox: seed,
          layers: ["slope", "hillshade", "contours"],
          format: "gpkg",
        },
      ]),
    );
  });

  // Mutation: drop the `areaExportTooLarge` check from `gisAreaError`.
  it("refuses a box over the limit, live and at Make it", () => {
    vi.mocked(apiFetch).mockClear();
    render(
      dialog({
        open: true,
        areaSeed: { north: -33, south: -35, east: 151, west: 149 },
      }),
    );
    chooseGis("GeoTIFF");
    expect(screen.getByText(AREA_EXPORT_TOO_LARGE)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Make it" }));
    expect(screen.getByText("A field below needs fixing first.")).toBeTruthy();
    expect(exportPosts()).toEqual([]);
  });

  // An edge left wrong is not committed, so the box underneath is the last
  // good one. Mutation: drop the edge-error check from handleExportArea.
  it("sends nothing while an edge shows an error, and opens Exact edges", () => {
    vi.mocked(apiFetch).mockClear();
    render(dialog({ open: true, areaSeed: seed }));
    chooseGis("GeoTIFF");
    const gisEdges = screen.getByText("Exact edges").closest("details")!;
    gisEdges.open = true;
    const north = screen.getByRole("textbox", { name: "North" });
    fireEvent.change(north, { target: { value: "-34" } });
    fireEvent.blur(north);
    gisEdges.open = false;

    fireEvent.click(screen.getByRole("button", { name: "Make it" }));
    expect(screen.getByText("A field below needs fixing first.")).toBeTruthy();
    expect(exportPosts()).toEqual([]);
    expect(screen.getByText("Exact edges").closest("details")!.open).toBe(true);
  });

  // The file takes in the readable areas inside its box (the API decides the
  // same at submit, with the same areasInBox). Mutation: count every area,
  // or none.
  it("says how many sharpened areas inside the box it includes", () => {
    const x = lon2tileX(seed.west, 15);
    const y = lat2tileY(seed.north, 15);
    const area = (id: string, tiles15: SharpenedArea["tiles15"]) => ({
      id,
      zmax: 16 as const,
      tiles15,
      coverage: [0, 0, 0, 0] as const,
      contours: true,
      credit: "",
      createdAt: "2026-10-20T00:00:00.000Z",
    });
    render(
      dialog({
        open: true,
        areaSeed: seed,
        sharpenedAreas: [
          area("in", [x, y, x + 1, y + 1]),
          area("far", [x + 90, y + 90, x + 91, y + 91]),
        ],
      }),
    );
    chooseGis("GeoTIFF");
    expect(
      screen.getByText(
        "1 sharpened area inside is included, at its own detail.",
      ),
    ).toBeTruthy();
  });

  // No caller passes `openWithGis` now (the Exports view was its last); the prop
  // goes with the dialog rework. Mutation: ignore `openWithGis`.
  it("opens on GeoTIFF with For GIS open when asked", () => {
    render(dialog({ open: true, openWithGis: true }));
    expect(
      screen
        .getByRole("radio", { name: "GeoTIFF" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByText("For GIS").closest("details")!.open).toBe(true);
  });

  // A requirement shows on Make it, a limit live (shared/DESIGN.md §11).
  // Mutation: drop the `gisTried` gate on "Pick at least one layer."
  it("asks for a layer only once Make it is pressed without one", () => {
    render(dialog({ open: true, areaSeed: seed }));
    chooseGis("GeoTIFF");
    for (const name of ["Heights", "Slope", "Hillshade"])
      fireEvent.click(screen.getByRole("checkbox", { name }));
    expect(screen.queryByText("Pick at least one layer.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Make it" }));
    expect(screen.getByText("Pick at least one layer.")).toBeTruthy();
  });

  // Two clicks on one spot draw a box with no size, which the API refuses as
  // a fault. Mutation: drop the no-size branch from `gisAreaLimit`.
  it("says a box with no size needs drawing again, and sends nothing", () => {
    vi.mocked(apiFetch).mockClear();
    render(
      dialog({
        open: true,
        areaSeed: { north: -33.6, south: -33.6, east: 150.3, west: 150.3 },
      }),
    );
    chooseGis("GeoTIFF");
    expect(
      screen.getByText("That box has no size. Draw it again on the map."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Make it" }));
    expect(exportPosts()).toEqual([]);
  });

  // Drawing the box closes the dialog and reopens it: a round trip, not a new
  // open. Mutation: drop `setReturningFromMapSelect(true)` from the GIS pick.
  it("keeps the format across Pick on the map, and takes the drawn box", () => {
    let pick = () => {};
    const props = { onPickArea: () => pick() };
    const { rerender } = render(dialog({ open: true, ...props }));
    chooseGis("GeoTIFF");
    pick = () => rerender(dialog({ open: false, ...props }));
    fireEvent.click(screen.getByRole("button", { name: "Pick on the map" }));
    rerender(dialog({ open: true, pendingArea: seed, ...props }));

    expect(
      screen
        .getByRole("radio", { name: "GeoTIFF" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByText("9.3 km × 11.1 km")).toBeTruthy();
  });
});

// Switching Coordinates rewrites the edge text in the same step as the mode,
// or one render checks metres as degrees and every edge flashes an error.
// A MutationObserver sees that render even though the effect heals it before
// the test looks. Mutation: refresh the edge text in an effect on the
// extent (or the GIS box) again instead of in the mode handler.
describe("GeoPdfDialog, switching Coordinates", () => {
  const flashes = (open: () => void) => {
    const seen: string[] = [];
    const observer = new MutationObserver(() => {});
    open();
    observer.observe(document.body, { childList: true, subtree: true });
    for (const mode of ["E/N", "Lat/Lon", "E/N"])
      fireEvent.click(screen.getByRole("radio", { name: mode }));
    for (const record of observer.takeRecords())
      for (const node of record.addedNodes)
        if (
          node instanceof Element &&
          (node.getAttribute("role") === "alert" ||
            node.querySelector('[role="alert"]'))
        )
          seen.push(node.textContent ?? "");
    observer.disconnect();
    return seen;
  };
  const withEdges = () => {
    const details = screen.getByText("Exact edges").closest("details")!;
    details.open = true;
  };

  it("flashes no error on the GeoPDF edges", () => {
    expect(
      flashes(() => {
        render(dialog({ open: true, areaSeed: seed }));
        withEdges();
      }),
    ).toEqual([]);
  });

  it("flashes no error on the GIS edges", () => {
    expect(
      flashes(() => {
        render(dialog({ open: true, areaSeed: seed }));
        chooseGis("GeoTIFF");
        withEdges();
      }),
    ).toEqual([]);
  });
});

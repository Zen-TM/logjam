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
import type { GeoPdfProgress, GeoPdfRenderInput } from "../../geoPdf/types";
import { downloadBlob } from "../../download";
import GeoPdfDialog from "./GeoPdfDialog";
import { GEOPDF_SETTINGS_KEY } from "./geoPdfSettings";
import type { TBbox } from "../map/Map";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import { ToastProvider } from "../feedback/ToastProvider";

vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  apiFetch: vi.fn(async () => ({})),
}));

// The renderer is its own chunk and needs a worker; tests drive its answer.
const renderGeoPdf = vi.hoisted(() => vi.fn());
vi.mock("./loadGeoPdfClient", () => ({
  loadGeoPdfClient: async () => ({ renderGeoPdf }),
}));
vi.mock("../../download", () => ({ downloadBlob: vi.fn() }));
type RenderOpts = {
  signal?: AbortSignal;
  onProgress?: (p: GeoPdfProgress) => void;
};
const okResult = {
  ok: true as const,
  pdf: new Blob(["%PDF"]),
  fileName: "logjam-geopdf.pdf",
};
const rendered = () =>
  renderGeoPdf.mock.calls.map(([input]) => input as GeoPdfRenderInput);

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
  renderGeoPdf.mockReset();
  renderGeoPdf.mockResolvedValue(okResult);
  vi.mocked(downloadBlob).mockClear();
});

function dialog({
  open,
  onClose = () => {},
  onSelectOnMap = () => {},
  ...props
}: {
  open: boolean;
  onSelectOnMap?: (...args: unknown[]) => void;
  pendingExtent?: TBbox | null;
  pendingScale?: number | null;
  completedTopoJobs?: CompletedTopoJob[];
  topoJobsLoaded?: boolean;
  onClose?: () => void;
  areaSeed?: TBbox | null;
  sharpenedAreas?: SharpenedArea[];
  onPickArea?: () => void;
  pendingArea?: TBbox | null;
  terrainLayers?: typeof TERRAIN_LAYER_DEFAULTS;
}) {
  return (
    <ToastProvider>
      <GeoPdfDialog
        open={open}
        onClose={onClose}
        onSelectOnMap={onSelectOnMap}
        pendingExtent={null}
        pendingScale={null}
        activeLayerId="six-topo"
        terrainLayers={TERRAIN_LAYER_DEFAULTS}
        completedTopoJobs={[]}
        slopeBands={[]}
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
const posted = () => rendered().map((input) => input.config);

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

  const slopeOn = () =>
    screen
      .getByRole("button", { name: "Slope" })
      .getAttribute("aria-pressed") === "true";

  // Mutation: drop `if (c.terrainPinned) setTerrainFollowsMap(false)` and a
  // pinned choice follows the map again; or pin whatever overlays are stored.
  it("pins Terrain only when it was pinned", () => {
    const open = (terrainPinned: boolean) => {
      localStorage.setItem(
        GEOPDF_SETTINGS_KEY,
        JSON.stringify({ overlays: ["contours"], terrainPinned }),
      );
      render(dialog({ open: true }));
    };
    open(true);
    expect(slopeOn()).toBe(false);
    cleanup();
    open(false);
    expect(slopeOn()).toBe(true);
  });

  // Mutation: stop passing the dialog's own base layers to `readSettings`.
  it("takes a stored base layer the dialog offers, not one it does not", () => {
    localStorage.setItem(
      GEOPDF_SETTINGS_KEY,
      JSON.stringify({ baseLayer: "six-imagery" }),
    );
    render(dialog({ open: true }));
    expect(screen.getByRole("radio", { name: "Imagery" }).ariaChecked).toBe(
      "true",
    );
    cleanup();

    // "osm" is a valid GeoPDF layer the dialog has no chip for.
    localStorage.setItem(
      GEOPDF_SETTINGS_KEY,
      JSON.stringify({ baseLayer: "osm" }),
    );
    render(dialog({ open: true }));
    expect(screen.getByRole("radio", { name: "Topo" }).ariaChecked).toBe(
      "true",
    );
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

const typeEdges = () =>
  fireEvent.click(screen.getByRole("radio", { name: "Type the edges" }));
const isTypingEdges = () =>
  screen
    .getByRole("radio", { name: "Type the edges" })
    .getAttribute("aria-checked") === "true";

// Coordinates and the edges wait behind Type the edges, which starts on the
// map; Make it switches to it when a field inside needs fixing, or the banner
// would point at a field nobody can see. With no map centre the seeded extent
// is all zeros, so North is not above South. Mutation: drop
// `setAreaView("edges")` from handleGenerate.
describe("GeoPdfDialog, Type the edges", () => {
  it("starts on the map and switches on Make it when an edge needs fixing", () => {
    render(dialog({ open: true }));
    expect(isTypingEdges()).toBe(false);
    expect(screen.queryByRole("textbox", { name: "North" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Make it" }));

    expect(isTypingEdges()).toBe(true);
    expect(screen.getByText("A field below needs fixing first.")).toBeTruthy();
  });

  // Typing an edge moves the box: the opposite edge follows by the same step
  // and East and West refit the paper. Mutation: make `applyNorthChange` set
  // only the north edge (a resize), and South stays put.
  it("moves the box when a GeoPDF edge is typed, the other edges following", () => {
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
      }),
    );
    typeEdges();
    const edge = (name: string) =>
      Number.parseFloat(
        (screen.getByRole("textbox", { name }) as HTMLInputElement).value,
      );
    const before = {
      south: edge("South"),
      east: edge("East"),
      west: edge("West"),
    };

    const north = screen.getByRole("textbox", { name: "North" });
    fireEvent.change(north, { target: { value: "-33.69" } });
    fireEvent.blur(north);

    expect(edge("North")).toBeCloseTo(-33.69, 5);
    expect(edge("South")).toBeCloseTo(before.south + 0.01, 5);
    // The paper's ratio refits the other axis, about its centre.
    expect(edge("East") - edge("West")).not.toBeCloseTo(
      before.east - before.west,
      5,
    );
    expect((edge("East") + edge("West")) / 2).toBeCloseTo(
      (before.east + before.west) / 2,
      5,
    );
  });

  // The lock and the pivot are gone: typing an edge moves the box. Mutation:
  // bring either control back.
  it("has no pivot or lock, and shows the four edges", () => {
    render(dialog({ open: true }));
    typeEdges();
    expect(screen.queryByRole("radiogroup", { name: "Pivot" })).toBeNull();
    expect(
      screen.queryByRole("radiogroup", { name: "Typing an edge" }),
    ).toBeNull();
    for (const name of ["North", "South", "East", "West"])
      expect(screen.getByRole("textbox", { name })).toBeTruthy();
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
// drop the `printed` gate from the Contours chip.
describe("GeoPdfDialog, the Terrain layers", () => {
  const contours = () =>
    screen.getByRole("button", { name: "Contours" }) as HTMLButtonElement;

  it("offers contours over imagery, and says the topo sheet prints its own", () => {
    render(dialog({ open: true }));
    expect(contours().disabled).toBe(true);
    expect(screen.getByText("This map prints its own contours.")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Imagery" }));
    expect(contours().disabled).toBe(false);
    expect(contours().getAttribute("aria-pressed")).toBe("true");
  });

  // Mutation: drop the hillshade reason from `offReason` (it stays ticked and
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
      screen.getByRole("button", { name: "Hillshade" }) as HTMLButtonElement;
    const pressed = () => hillshade().getAttribute("aria-pressed") === "true";
    expect(hillshade().disabled).toBe(false);
    expect(pressed()).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "Imagery" }));
    expect(hillshade().disabled).toBe(true);
    expect(pressed()).toBe(false);
    expect(
      screen.getByText(`${MAP_TERRAIN.copy.hillshadeImagery}.`),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Make it" }));
    await vi.waitFor(() => {
      expect(rendered()).toHaveLength(1);
      expect(rendered()[0]!.config.overlays).not.toContain("hillshade");
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
    screen.getByRole("button", { name: "Hillshade" }) as HTMLButtonElement;
  const on = () => hillshade().getAttribute("aria-pressed") === "true";
  const at = (pendingExtent: TBbox) =>
    dialog({
      open: true,
      completedTopoJobs: [job],
      pendingExtent,
      pendingScale: 25000,
    });

  it("follows the area until the user chooses", () => {
    const { rerender } = render(at(away));
    expect(on()).toBe(false);
    rerender(at(overJob));
    expect(on()).toBe(true);

    fireEvent.click(hillshade());
    rerender(at(away));
    rerender(at(overJob));
    expect(on()).toBe(false);
  });
});

// Shared places are opt-in on a printable artifact: a friend consented to
// seeing them in Logjam, not to being named on a PDF. Mutation: start the
// chip pressed, or drop its hint.
describe("GeoPdfDialog, the Overlays group", () => {
  it("starts with My places on and Shared places off, and says why", () => {
    render(dialog({ open: true }));
    const pressed = (name: string) =>
      screen.getByRole("button", { name }).getAttribute("aria-pressed");
    expect(pressed("My places")).toBe("true");
    expect(pressed("Shared places")).toBe("false");
    expect(
      screen.getByText(/not with whoever you hand the PDF to/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Shared places" }));
    expect(pressed("Shared places")).toBe("true");
  });
});

const seed: TBbox = { north: -33.6, south: -33.7, east: 150.3, west: 150.2 };

function chooseGis(format: "GeoTIFF" | "GeoPackage" | "MBTiles") {
  fireEvent.click(screen.getByRole("radio", { name: format }));
}

const layer = (name: string) => screen.getByRole("button", { name });

const exportPosts = () =>
  vi
    .mocked(apiFetch)
    .mock.calls.filter(([path]) => path === "/topo-exports")
    .map(([, init]) => (init as { body: unknown }).body);

describe("Export an area, for GIS", () => {
  // Mutation: start `format` at a GIS format.
  it("opens on GeoPDF", () => {
    render(dialog({ open: true }));
    expect(
      screen
        .getByRole("radio", { name: "GeoPDF" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  // One rail holds all four formats. Mutation: split them into two groups
  // again, and a screen reader hears a "Format" with nothing checked.
  it("offers every format in one Format group", () => {
    render(dialog({ open: true }));
    const format = screen.getByRole("radiogroup", { name: "Format" });
    for (const name of ["GeoPDF", "GeoTIFF", "GeoPackage", "MBTiles"])
      expect(within(format).getByRole("radio", { name })).toBeTruthy();
  });

  // A GIS file is a free box: no paper, and only the layers the format holds.
  // Mutation: render the GeoPDF body whatever the format, or list every layer.
  it("drops the paper and offers only the format's layers", () => {
    render(dialog({ open: true, areaSeed: seed }));
    chooseGis("GeoTIFF");
    expect(screen.queryByRole("radiogroup", { name: "Paper size" })).toBeNull();
    expect(layer("Heights")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Contours" })).toBeNull();

    chooseGis("MBTiles");
    expect(screen.queryByRole("button", { name: "Heights" })).toBeNull();
    expect(layer("Contours")).toBeTruthy();
  });

  // Mutation: post the GeoPDF's extent instead of the box, or send a layer
  // that is unticked.
  it("sends the box it was opened over, the ticked layers and the format", async () => {
    vi.mocked(apiFetch).mockClear();
    render(dialog({ open: true, areaSeed: seed }));
    chooseGis("GeoPackage");
    fireEvent.click(layer("Heights"));
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
  it("sends nothing while an edge shows an error, and switches to Type the edges", () => {
    vi.mocked(apiFetch).mockClear();
    render(dialog({ open: true, areaSeed: seed }));
    chooseGis("GeoTIFF");
    typeEdges();
    const north = screen.getByRole("textbox", { name: "North" });
    fireEvent.change(north, { target: { value: "-34" } });
    fireEvent.blur(north);
    fireEvent.click(screen.getByRole("radio", { name: "On the map" }));

    fireEvent.click(screen.getByRole("button", { name: "Make it" }));
    expect(screen.getByText("A field below needs fixing first.")).toBeTruthy();
    expect(exportPosts()).toEqual([]);
    expect(isTypingEdges()).toBe(true);
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

  // A requirement shows on Make it, a limit live (shared/DESIGN.md §11).
  // Mutation: drop the `gisTried` gate on "Pick at least one layer."
  it("asks for a layer only once Make it is pressed without one", () => {
    render(dialog({ open: true, areaSeed: seed }));
    chooseGis("GeoTIFF");
    for (const name of ["Heights", "Slope", "Hillshade"])
      fireEvent.click(layer(name));
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
  const withEdges = typeEdges;

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

// Make it renders in this tab. Mutations: POST /geo-pdf again; let Cancel close
// the dialog or skip `abort()`; save settings or download on a failed render.
describe("GeoPdfDialog, rendering in this tab", () => {
  const make = (props: Parameters<typeof dialog>[0] = { open: true }) => {
    render(dialog({ pendingExtent: extent, pendingScale: 50000, ...props }));
    fireEvent.click(screen.getByRole("button", { name: "Make it" }));
  };

  it("downloads, saves the settings and closes, with no /geo-pdf request", async () => {
    const onClose = vi.fn();
    make({ open: true, onClose });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(downloadBlob).toHaveBeenCalledWith(
      okResult.pdf,
      "logjam-geopdf.pdf",
    );
    expect(localStorage.getItem(GEOPDF_SETTINGS_KEY)).not.toBeNull();
    expect(
      vi.mocked(apiFetch).mock.calls.filter(([p]) => p === "/geo-pdf"),
    ).toEqual([]);
  });

  it("shows progress, and Cancel aborts it and keeps the dialog open", async () => {
    const onClose = vi.fn();
    let signal: AbortSignal | undefined;
    renderGeoPdf.mockImplementation(
      (_input: unknown, opts: RenderOpts) =>
        new Promise((resolve) => {
          signal = opts.signal;
          opts.onProgress?.({
            phase: "drawing",
            done: 1,
            total: 4,
            fraction: 0.25,
          });
          opts.signal?.addEventListener("abort", () =>
            resolve({ ok: false, reason: "cancelled" }),
          );
        }),
    );
    make({ open: true, onClose });
    const bar = await screen.findByRole("progressbar");
    await vi.waitFor(() =>
      expect(bar.getAttribute("aria-valuenow")).toBe("25"),
    );
    // The live region holds only the phase; the percent is the bar's value.
    expect(screen.getByRole("status").textContent).toBe("Drawing the map.");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    await vi.waitFor(() =>
      expect(screen.queryByRole("progressbar")).toBeNull(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("says so when the map is too large, and when the render fails", async () => {
    renderGeoPdf.mockResolvedValueOnce({
      ok: false,
      reason: "too-large",
    });
    make();
    expect(await screen.findByText(GEOPDF_TOO_LARGE)).toBeTruthy();
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(localStorage.getItem(GEOPDF_SETTINGS_KEY) ?? "null").toBe("null");

    renderGeoPdf.mockResolvedValueOnce({
      ok: false,
      reason: "failed",
    });
    fireEvent.click(screen.getByRole("button", { name: "Make it" }));
    expect(
      await screen.findByText(
        "Couldn't make the GeoPDF. Check your connection, or try another base map.",
      ),
    ).toBeTruthy();
  });

  const jobOf = (id: string, syncRole: "owner" | "shared", createdAt: string) =>
    ({
      jobId: id,
      syncRole,
      createdAt,
      footprint: null,
      layers: [
        { name: "vegetation", format: "raster", pmtilesUrl: `https://v/${id}` },
      ],
      sharpened: { id: `${id}-area` },
    }) as unknown as CompletedTopoJob;

  // Mutations: pass every job's vegetation (the shared job's leaks into the
  // PDF); pass no areas (a sharee's sharpened terrain is dropped).
  it("draws only the user's own vegetation, but every readable sharpened area", async () => {
    make({
      open: true,
      completedTopoJobs: [
        jobOf("mine", "owner", "2026-01-01"),
        jobOf("theirs", "shared", "2026-01-02"),
      ],
    });
    await vi.waitFor(() => expect(rendered()).toHaveLength(1));
    const input = rendered()[0]!;
    expect(input.vegetationUrls).toEqual(["https://v/mine"]);
    expect(input.areas.map((a) => (a as { id: string }).id)).toEqual([
      "mine-area",
      "theirs-area",
    ]);
  });

  // Mutation: drop `!topoJobsLoaded` from the button's busy term, and a render
  // starts before the sharpened areas are known.
  it("waits for the completed jobs before rendering", async () => {
    const props = { pendingExtent: extent, pendingScale: 50000 };
    const { rerender } = render(
      dialog({ open: true, topoJobsLoaded: false, ...props }),
    );
    const makeIt = screen.getByRole("button", { name: "Make it" });
    expect(makeIt.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(makeIt);
    expect(rendered()).toHaveLength(0);

    rerender(dialog({ open: true, topoJobsLoaded: true, ...props }));
    fireEvent.click(screen.getByRole("button", { name: "Make it" }));
    await vi.waitFor(() => expect(rendered()).toHaveLength(1));
  });

  it("aborts a render when the dialog closes", async () => {
    let signal: AbortSignal | undefined;
    renderGeoPdf.mockImplementation((_i: unknown, opts: RenderOpts) => {
      signal = opts.signal;
      return new Promise(() => {});
    });
    make();
    await vi.waitFor(() => expect(signal).toBeDefined());
    cleanup();
    expect(signal?.aborted).toBe(true);
  });
});

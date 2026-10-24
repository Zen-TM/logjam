import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AREA_EXPORT_TOO_LARGE,
  GEOPDF_TOO_LARGE,
  TERRAIN_LAYER_DEFAULTS,
} from "@logjam/shared";
import { apiFetch } from "../../placeUtils";
import GeoPdfDialog, { type GeoPdfTemplate } from "./GeoPdfDialog";
import type { TBbox } from "../map/Map";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import { ToastProvider } from "../feedback/ToastProvider";

const template = {
  id: "t1",
  name: "Template one",
  config: {
    paperSize: "A4",
    orientation: "portrait",
    scale: 25000,
    baseLayer: "six-topo",
    overlays: [],
    elements: {
      title: "From the template",
      compass: true,
      scaleText: true,
      scaleBar: true,
    },
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as unknown as GeoPdfTemplate;

vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  apiFetch: vi.fn(async () => [template]),
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

afterEach(cleanup);

function dialog({
  open,
  onSelectOnMap = () => {},
  ...props
}: {
  open: boolean;
  onSelectOnMap?: (...args: unknown[]) => void;
  templateMode?: boolean;
  editingTemplate?: GeoPdfTemplate | null;
  initialTemplateId?: string | null;
  pendingExtent?: TBbox | null;
  pendingScale?: number | null;
  completedTopoJobs?: CompletedTopoJob[];
  areaSeed?: TBbox | null;
  onPickArea?: () => void;
  pendingArea?: TBbox | null;
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

const titleBox = () =>
  screen.getByRole("textbox", { name: "Map title" }) as HTMLInputElement;

// A template fills the form once per genuine open. "Select on map" closes the
// dialog and reopens it, which is not a new open: edits made before the pick
// must survive it. Mutation for the launch-template case: drop the
// `appliedTemplate` gate in `applyLaunchTemplate`. (The template-mode step's
// round-trip guard has no UI route to test: template mode offers no
// Select on map.)
describe("GeoPdfDialog, across a Select on map round trip", () => {
  it("keeps edits made over a launch template", async () => {
    let selectOnMap = () => {};
    const props = {
      initialTemplateId: "t1",
      onSelectOnMap: () => selectOnMap(),
    };
    const { rerender } = render(dialog({ open: true, ...props }));
    await vi.waitFor(() => expect(titleBox().value).toBe("From the template"));

    fireEvent.change(titleBox(), { target: { value: "My edit" } });
    selectOnMap = () => rerender(dialog({ open: false, ...props }));
    fireEvent.click(screen.getByRole("button", { name: "Pick on the map" }));
    rerender(dialog({ open: true, ...props }));
    await vi.waitFor(() => expect(titleBox().value).toBe("My edit"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(titleBox().value).toBe("My edit");
  });

  // The step that fills the form from the template being edited keys on
  // template ID rather than the template object, so a fresh copy of the same
  // template (a refetch) does not wipe the form. Mutation: key
  // `templatePopulatedFor` on `editingTemplate` instead of
  // `editingTemplate?.id`.
  it("keeps edits to a template when it is handed over again", async () => {
    const props = { templateMode: true };
    const { rerender } = render(
      dialog({ open: true, editingTemplate: template, ...props }),
    );
    expect(titleBox().value).toBe("From the template");

    fireEvent.change(titleBox(), { target: { value: "My edit" } });
    rerender(
      dialog({ open: true, editingTemplate: { ...template }, ...props }),
    );

    expect(titleBox().value).toBe("My edit");
  });

  it("fills the form from a template when it is opened", () => {
    render(
      dialog({ open: true, editingTemplate: template, templateMode: true }),
    );
    expect(titleBox().value).toBe("From the template");
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

  // A template has no area. Mutation: drop the `!templateMode` gate.
  it("is absent, with the area, in template mode", () => {
    render(dialog({ open: true, templateMode: true }));
    expect(screen.queryByText("Exact edges")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Pick on the map" }),
    ).toBeNull();
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
  const slope = () =>
    screen.getByRole("checkbox", { name: /^Slope/ }) as HTMLInputElement;
  const at = (pendingExtent: TBbox) =>
    dialog({
      open: true,
      completedTopoJobs: [job],
      pendingExtent,
      pendingScale: 25000,
    });

  it("follows the area until the user chooses", () => {
    const { rerender } = render(at(away));
    expect(slope().checked).toBe(false);
    rerender(at(overJob));
    expect(slope().checked).toBe(true);

    fireEvent.click(slope());
    rerender(at(away));
    rerender(at(overJob));
    expect(slope().checked).toBe(false);
  });
});

// A new template has no area: its Terrain layers follow the map's switches,
// and a job's own layers turn them on only for a user who has one. Mutation:
// hand `shownOverlays` the template's `lidarOverlap` (always true), and a
// user with no LiDAR job saves slope and shading for every sheet.
describe("GeoPdfDialog, a new template's Terrain layers", () => {
  const slope = () =>
    screen.getByRole("checkbox", { name: /^Slope/ }) as HTMLInputElement;
  const ownJob = {
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

  it("follows the map for a user with no job", () => {
    render(dialog({ open: true, templateMode: true }));
    expect(slope().checked).toBe(false);
  });

  // Mutation: drop ownJobInArea's empty-area branch (or give a template
  // `jobInArea = false`), and a user with a job of their own gets a template
  // with Terrain off.
  it("turns on for a user with a job of their own", () => {
    render(
      dialog({ open: true, templateMode: true, completedTopoJobs: [ownJob] }),
    );
    expect(slope().checked).toBe(true);
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

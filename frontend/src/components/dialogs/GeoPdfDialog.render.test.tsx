import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import GeoPdfDialog, { type GeoPdfTemplate } from "./GeoPdfDialog";
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

// The NSW series are chips; Other opens today's typed field. The scale picked
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

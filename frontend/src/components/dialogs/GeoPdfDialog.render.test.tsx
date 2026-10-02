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
  BASE_LAYERS: [{ id: "six-topo", name: "Topo", kind: "raster", tiles: [] }],
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
  onSelectOnMap?: () => void;
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
    fireEvent.click(screen.getByRole("button", { name: /Draw the area/ }));
    rerender(dialog({ open: true, ...props }));
    await vi.waitFor(() => expect(titleBox().value).toBe("My edit"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(titleBox().value).toBe("My edit");
  });

  // The step that fills the form from the template being edited used to key on
  // the template OBJECT, so a fresh copy of the same template (a refetch) wiped
  // the form. Mutation: key `templatePopulatedFor` on `editingTemplate` again
  // instead of `editingTemplate?.id`.
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

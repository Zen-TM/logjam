import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../feedback/ToastProvider";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import SharpenedAreasView from "./SharpenedAreasView";

const api = vi.hoisted(() => ({ apiFetch: vi.fn(async () => ({})) }));
vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  ...api,
}));

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = () => {};
Object.assign(HTMLElement.prototype, {
  showPopover(this: HTMLElement) {
    this.removeAttribute("popover");
  },
  hidePopover() {},
  togglePopover() {},
});
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute("open");
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const footprint = {
  type: "Polygon" as const,
  coordinates: [
    [
      [150, -33],
      [150.1, -33],
      [150.1, -33.1],
      [150, -33],
    ],
  ],
};
const job = (over: Partial<CompletedTopoJob>): CompletedTopoJob => ({
  jobId: "j1",
  syncRole: "owner",
  name: "Made-up gully",
  createdAt: "2026-10-01T00:00:00Z",
  footprint,
  layers: [],
  ...over,
});

function draw(jobs: CompletedTopoJob[]) {
  const props = {
    onBack: vi.fn(),
    onClose: vi.fn(),
    activeTopoJobs: [],
    completedTopoJobs: jobs,
    friends: [],
    onSharpen: vi.fn(),
    onExportArea: vi.fn(),
    onFlyTo: vi.fn(),
    onRefetchCompletedTopoJobs: vi.fn(),
    onDismissActiveJob: vi.fn(),
    onQuotaChanged: vi.fn(),
  };
  render(
    <ToastProvider>
      <SharpenedAreasView {...props} />
    </ToastProvider>,
  );
  return props;
}

describe("the sharpened areas view", () => {
  it("lists areas with a Shared pill on one shared with you, and flies to a row", () => {
    const props = draw([
      job({}),
      job({ jobId: "j2", name: "Friend's ridge", syncRole: "shared" }),
    ]);
    expect(screen.getAllByText("Shared")).toHaveLength(1);
    fireEvent.click(screen.getAllByText("Made-up gully")[0]!);
    expect(props.onFlyTo).toHaveBeenCalledWith(footprint);
  });

  // Mutation: run the delete without waiting for the confirm, and cancelling
  // still deletes the area.
  it("deletes only once the confirm is accepted", () => {
    draw([job({})]);
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Made-up gully" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByText("Delete Made-up gully?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.apiFetch).not.toHaveBeenCalled();
  });

  it("offers Share and Delete to the owner, Remove to a sharee", () => {
    draw([job({ jobId: "j2", name: "Friend's ridge", syncRole: "shared" })]);
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Friend's ridge" }),
    );
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /^Share/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Remove" })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "Export this area…" }),
    ).toBeTruthy();
  });

  it("arms the pick from the Sharpen an area button", () => {
    const props = draw([]);
    fireEvent.click(screen.getByRole("button", { name: "Sharpen an area" }));
    expect(props.onSharpen).toHaveBeenCalled();
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TRoute } from "../../../placeUtils";
import { ToastProvider } from "../../feedback/ToastProvider";
import { createRouteHoverChannel } from "../../map/routeHover";
import WayDetailPanel from "./WayDetailPanel";
import type { WayItem } from "./waysModel";

const api = vi.hoisted(() => ({
  copyRoute: vi.fn(),
  updateRoute: vi.fn(),
  unshareEntityWith: vi.fn(),
  getEntityShares: vi.fn(async () => []),
}));
vi.mock("../../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../placeUtils")>()),
  ...api,
  useElevationProfile: () => ({ profile: null, loading: false, error: null }),
}));

// jsdom has no modal <dialog>; the kit's Dialog calls both.
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

const route: TRoute = {
  id: "r1",
  ownerId: "bob",
  placeId: null,
  name: "Ridge line",
  color: "#e6194b",
  points: [
    [150.3, -33.7],
    [150.31, -33.71],
  ],
  anchors: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const way: WayItem = {
  key: "route:r1",
  kind: "route",
  id: "r1",
  title: "Ridge line",
  distanceM: 1400,
  color: route.color,
  shared: true,
  viaPlace: false,
  hasOrigin: true,
  placeId: null,
  createdAt: route.createdAt,
  bounds: [150.3, -33.71, 150.31, -33.7],
  hasTrip: false,
};

function mount(initialVerb: string, over: Partial<WayItem> = {}) {
  render(
    <ToastProvider>
      <WayDetailPanel
        way={{ ...way, ...over }}
        route={route}
        file={null}
        placeTrack={null}
        initialVerb={initialVerb as never}
        onVerbConsumed={() => {}}
        friends={[]}
        ownedPlaces={[]}
        sharedPlaces={[]}
        allRoutes={[]}
        onBack={() => {}}
        onEdit={() => {}}
        onCopied={() => {}}
        onChanged={() => {}}
        onOpenPlace={() => {}}
        onLogTrip={() => {}}
        onDeleteFile={async () => {}}
        routeHover={createRouteHoverChannel()}
      />
    </ToastProvider>,
  );
}

function saveAndRemove() {
  mount("copyAndRemove");
  fireEvent.click(screen.getByRole("button", { name: "Save and remove" }));
}

describe("WayDetailPanel: save a shared route and remove the share", () => {
  // Mutation: unshare before (or alongside) the copy.
  it("never removes the share when the copy fails", async () => {
    api.copyRoute.mockRejectedValueOnce(new Error("offline"));
    saveAndRemove();
    await waitFor(() => expect(api.copyRoute).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve));
    expect(api.unshareEntityWith).not.toHaveBeenCalled();
  });

  it("removes the share once the copy has landed", async () => {
    api.copyRoute.mockResolvedValueOnce({ ...route, id: "r2", ownerId: "me" });
    api.unshareEntityWith.mockResolvedValueOnce(undefined);
    saveAndRemove();
    await waitFor(() =>
      expect(api.unshareEntityWith).toHaveBeenCalledWith("route", "r1", "me"),
    );
    expect(api.copyRoute.mock.invocationCallOrder[0]).toBeLessThan(
      api.unshareEntityWith.mock.invocationCallOrder[0],
    );
  });
});

describe("WayDetailPanel: rename a route", () => {
  // Mutation: withhold "rename" from a route in `wayVerbs`, or send the
  // name through `renameMedia` instead of `updateRoute`.
  it("renames an owned route in one step", async () => {
    api.updateRoute.mockResolvedValueOnce({ ...route, name: "Spur" });
    mount("rename", { shared: false });
    fireEvent.change(screen.getByLabelText("Route name"), {
      target: { value: "Spur" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.updateRoute).toHaveBeenCalledWith("r1", { name: "Spur" }),
    );
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WAY_IMPORT } from "@logjam/shared";
import RoutesPanel from "./RoutesPanel";

vi.mock("../../feedback/ToastProvider", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView = () => {};
Object.assign(HTMLElement.prototype, {
  showPopover(this: HTMLElement) {
    this.removeAttribute("popover");
  },
  hidePopover() {},
  togglePopover() {},
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

const draw = () => {
  const onImportWay = vi.fn();
  render(
    <RoutesPanel
      routes={[]}
      waysLoaded
      currentUserId="alice"
      friends={[]}
      placeTracks={[]}
      standaloneFiles={[]}
      standaloneFilesError={null}
      onRetryStandaloneFiles={() => {}}
      places={[]}
      sharedPlaces={[]}
      onStartDrawingRoute={() => {}}
      onImportWay={onImportWay}
      onOpenWay={() => {}}
      onOpenPlace={() => {}}
    />,
  );
  return onImportWay;
};

describe("the Ways list's import", () => {
  // Mutation: point the Add menu's import back at the CSV importer, or leave
  // its old "Import from CSV" label.
  it("offers a GPX, KML or GeoJSON file, never a CSV, from the Add menu", () => {
    const onImportWay = draw();
    fireEvent.click(screen.getByRole("button", { name: /^Add/ }));
    expect(screen.queryByRole("menuitem", { name: /CSV/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: WAY_IMPORT.menu }));
    expect(onImportWay).toHaveBeenCalledTimes(1);
  });

  it("offers the same import from the empty state, under Logjam GPS's short name", () => {
    const onImportWay = draw();
    expect(screen.queryByText(/CSV/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: WAY_IMPORT.file }));
    expect(onImportWay).toHaveBeenCalledTimes(1);
  });
});

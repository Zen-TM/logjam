import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ExportsPanel from "./ExportsPanel";
import { ToastProvider } from "../../feedback/ToastProvider";

afterEach(cleanup);

function panel(props: { loaded: boolean; error: string | null }) {
  const refetch = vi.fn();
  render(
    <ToastProvider>
      <ExportsPanel
        views={null}
        topoExports={[]}
        topoExportsTotal={null}
        completedTopoJobs={[]}
        onRefetchTopoExports={refetch}
        onQuotaChanged={() => {}}
        onOpenExport={() => {}}
        {...props}
      />
    </ToastProvider>,
  );
  return refetch;
}

// Loading is not empty, and failed is neither (shared/DESIGN.md §11).
describe("Maps, Exports, before it has a list", () => {
  // Mutation: drop the error branch, and a failed first fetch reads as empty.
  it("says a failed load failed, with Try again, rather than empty", () => {
    const refetch = panel({ loaded: true, error: "Couldn't load exports." });
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't load exports.",
    );
    expect(screen.queryByText("No exports yet")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  // Mutation: drop the !loaded branch, and a load in flight reads as
  // "No exports yet".
  it("says it is loading until the first fetch settles", () => {
    panel({ loaded: false, error: null });
    expect(screen.getByText("Loading your exports…")).toBeTruthy();
    expect(screen.queryByText("No exports yet")).toBeNull();
  });
});

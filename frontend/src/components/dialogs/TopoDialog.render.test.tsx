import { readFileSync } from "node:fs";
import { join } from "node:path";

import { RASTER_TEMPLATE_DEFAULTS } from "@logjam/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import TopoDialog from "./TopoDialog";

vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  apiFetch: vi.fn(async () => ({})),
  // These two call placeUtils' own apiFetch, so replacing the export above
  // does not reach them. Left real they fetched localhost, and the failure
  // logged while the worker was tearing down (setup-smoke's intermittent
  // EnvironmentTeardownError on "onUserConsoleLog").
  fetchCurrentUser: vi.fn(
    async () =>
      ({
        monthlyComputeUsage: 0,
        monthlyComputeCredits: 600,
        monthlyComputeResetAt: "",
        storageUsedBytes: 0,
        storageQuotaBytes: 1_000_000_000,
      }) as never,
  ),
  fetchComputeEstimate: vi.fn(
    async () =>
      ({
        estimatedSeconds: null,
        credits: null,
        used: 0,
        quota: 0,
        remaining: 0,
        resetAt: "",
        wouldExceed: false,
      }) as never,
  ),
}));

// Mutation: drop either stub above, and the afterEach assertion goes red.
const network = vi.fn(async () => {
  throw new Error("a unit test must not reach the network");
});
vi.stubGlobal("fetch", network);

const discard = vi.fn();
const submit = vi.hoisted(() => vi.fn());
vi.mock("./topoUpload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./topoUpload")>()),
  useTopoUpload: () => ({ submit, discard, held: false }),
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
  submit.mockReset();
  cleanup();
  discard.mockClear();
  expect(network).not.toHaveBeenCalled();
});

function dialog(props: { open: boolean; awaitingBbox?: boolean }) {
  return (
    <TopoDialog
      onClose={() => {}}
      onSelectBbox={() => {}}
      awaitingBbox={false}
      pendingBbox={null}
      onJobCreated={() => {}}
      existingTopoNames={[]}
      {...props}
    />
  );
}

// Mutation: remove `upload.discard()` from onFilePicked, and the held job
// keeps the fields locked after a new ZIP is chosen.
describe("TopoDialog, choosing a ZIP", () => {
  it("lets the held job go", () => {
    const { container } = render(dialog({ open: true }));
    const input = container.ownerDocument.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const zip = new File(["PK"], "survey.zip", { type: "application/zip" });
    fireEvent.change(input, { target: { files: [zip] } });
    expect(discard).toHaveBeenCalledTimes(1);
  });
});

describe("TopoDialog", () => {
  // Mutation: a title of its own instead of LIDAR_JOB_COPY's.
  it("sharpens an area", () => {
    render(dialog({ open: true }));
    expect(
      screen.getByRole("heading", { name: "Sharpen an area" }),
    ).toBeTruthy();
  });
});

/** A made-up ELVIS ZIP holding one point cloud (the a11y spec's fixture). */
const lazZip = () =>
  new File(
    [
      readFileSync(
        join(__dirname, "../../../e2e/__fixtures__/elvis-point-clouds.zip"),
      ),
    ],
    "survey.zip",
    { type: "application/zip" },
  );
const pick = (container: HTMLElement, file: File) =>
  fireEvent.change(
    container.ownerDocument.querySelector('input[type="file"]')!,
    { target: { files: [file] } },
  );
const vegetationBox = () =>
  screen.findByRole("checkbox", { name: /Vegetation \(experimental\)/ });

describe("TopoDialog's Vegetation choice", () => {
  // Mutation: leave Vegetation out of the reset, and the next job, which
  // nobody ticked, runs the vegetation pass because the last one did.
  it("is off again for the next job", async () => {
    const { container, rerender } = render(dialog({ open: true }));
    pick(container, lazZip());
    fireEvent.click(await vegetationBox());
    expect((await vegetationBox()) as HTMLInputElement).toHaveProperty(
      "checked",
      true,
    );
    rerender(dialog({ open: false }));
    rerender(dialog({ open: true }));
    pick(container, lazZip());
    expect((await vegetationBox()) as HTMLInputElement).toHaveProperty(
      "checked",
      false,
    );
  });

  // Mutation: send the tick as it was before the box was clicked, or any
  // style but the default.
  it("is sent with the default style", async () => {
    const { container } = render(dialog({ open: true }));
    pick(container, lazZip());
    fireEvent.click(await vegetationBox());
    submit.mockResolvedValue("job-1");
    fireEvent.click(screen.getByRole("button", { name: "Make it" }));
    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    const sent = submit.mock.calls[0]![1];
    expect(sent.settings).toEqual({
      ...RASTER_TEMPLATE_DEFAULTS,
      vegetation: { ...RASTER_TEMPLATE_DEFAULTS.vegetation, enabled: true },
    });
  });
});

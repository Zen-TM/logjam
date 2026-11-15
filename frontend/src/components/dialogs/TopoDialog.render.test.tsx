import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  NSW_REGION,
  RASTER_TEMPLATE_DEFAULTS,
  SHARPEN_OFF_REASON,
  SIM_NZ,
  SIM_UTAH,
  WORLD,
  sharpenOffer,
  type SharpenOffer,
} from "@logjam/shared";
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

function dialog(props: {
  open: boolean;
  awaitingBbox?: boolean;
  offer?: SharpenOffer;
  onClose?: () => void;
}) {
  return (
    <TopoDialog
      offer={sharpenOffer(NSW_REGION)}
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

const heading = (name: string) => screen.getByRole("heading", { name });
const button = (name: string | RegExp) => screen.getByRole("button", { name });

// What Logjam Web said before a region chose its portal, word for word: New
// South Wales, the only region in prod, must read as it did.
describe("TopoDialog in New South Wales", () => {
  // Mutation: change a word of the ELVIS hint in TopoDialog.tsx ("No need to
  // unzip it."), or write "ELVIS" into the drop line's template.
  it("names ELVIS in the drop zone and the errand button", () => {
    render(dialog({ open: true }));
    expect(
      screen.getByText(
        "Drop your ELVIS ZIP here, or select it in your file system.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("No need to unzip it.")).toBeTruthy();
    expect(button("Haven't got one? Order LiDAR from ELVIS")).toBeTruthy();
    expect(screen.getByText("Name")).toBeTruthy();
  });

  // Mutation: send the ELVIS steps through the link sub-view, or open a
  // portal address other than the one NSW declares.
  it("walks through ELVIS's four steps and opens its portal", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(dialog({ open: true }));
    fireEvent.click(button("Haven't got one? Order LiDAR from ELVIS"));
    expect(heading("Getting LiDAR from ELVIS")).toBeTruthy();
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual([
      "Mark out what you want covered",
      "Order the data from ELVIS",
      "Take the 1 m or 2 m DEM",
      "Have it sent to you",
    ]);
    fireEvent.click(button("Open the ELVIS portal"));
    expect(open).toHaveBeenCalledWith(
      "https://elevation.fsdf.org.au/",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });
});

describe("TopoDialog where the region's portal has no errand of its own", () => {
  const usgs = () => sharpenOffer(SIM_UTAH);

  // Mutation: hard-code "ELVIS" in the drop line, or leave the one-ZIP hint
  // as ELVIS's "No need to unzip it.".
  it("names that portal and says an upload is one ZIP", () => {
    render(dialog({ open: true, offer: usgs() }));
    expect(
      screen.getByText(
        "Drop your USGS ZIP here, or select it in your file system.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Put all the files in one ZIP.")).toBeTruthy();
    expect(button("Haven't got one? Get LiDAR from USGS")).toBeTruthy();
    expect(screen.queryByText(/ELVIS/)).toBeNull();
  });

  // Mutation: send this portal through ElvisInstructions (swap the two
  // `steps` conditions in TopoDialog.tsx).
  it("gives the portal's link and the reminder to zip, and no shapefile errand", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(dialog({ open: true, offer: usgs() }));
    fireEvent.click(button("Haven't got one? Get LiDAR from USGS"));
    expect(heading("Getting LiDAR from USGS")).toBeTruthy();
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual(["Get the LiDAR from USGS", "Put the files in one ZIP"]);
    expect(screen.queryByText(/shapefile/i)).toBeNull();
    fireEvent.click(button("Open the USGS portal"));
    expect(open).toHaveBeenCalledWith(
      "https://apps.nationalmap.gov/lidar-explorer/",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });

  // Mutation: show Vegetation whatever the region's `vegetation` says, and a
  // region with no vegetation model offers a layer its worker leaves out.
  it("does not offer Vegetation, which the region has no model for", async () => {
    const { container } = render(dialog({ open: true, offer: usgs() }));
    pick(container, lazZip());
    await screen.findByText("Survey");
    expect(screen.queryByRole("checkbox", { name: /Vegetation/ })).toBeNull();
  });
});

describe("TopoDialog where the region has no sharpening", () => {
  const OFF: [string, SharpenOffer, string][] = [
    ["already-fine", sharpenOffer(SIM_NZ), SHARPEN_OFF_REASON["already-fine"]],
    ["no-lidar", sharpenOffer(WORLD), SHARPEN_OFF_REASON["no-lidar"]],
  ];

  // Mutation: render the form for an `off` offer (make its condition in
  // TopoDialog.tsx never true).
  it.each(OFF)(
    "says Not available here and why (%s), and offers no ZIP",
    (_reason, offer, sentence) => {
      const onClose = vi.fn();
      const { container } = render(dialog({ open: true, offer, onClose }));
      expect(heading("Not available here")).toBeTruthy();
      expect(screen.getByText(sentence)).toBeTruthy();
      expect(container.ownerDocument.querySelector('input[type="file"]')).toBe(
        null,
      );
      expect(screen.queryByRole("button", { name: "Make it" })).toBeNull();
      fireEvent.click(button("Close"));
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AUTO_EXPORT_DEFAULTS, RASTER_TEMPLATE_DEFAULTS } from "@logjam/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The switch, read at each render: the template tests hold the form it
// brings back when set off (a revert is one line), the rest the form it shows.
const switches = vi.hoisted(() => ({ sharpen: false }));
vi.mock("@logjam/shared", async (importOriginal) => {
  const shared = await importOriginal<typeof import("@logjam/shared")>();
  return {
    ...shared,
    get SHARPEN_NEW_JOBS() {
      return switches.sharpen;
    },
  };
});

import TopoDialog, { type TopoTemplate } from "./TopoDialog";
import { apiFetch } from "../../placeUtils";

const template = (id: string): TopoTemplate => ({
  id,
  name: `Template ${id}`,
  isSystem: false,
  config: RASTER_TEMPLATE_DEFAULTS,
  autoExport: null,
  createdAt: null,
  updatedAt: null,
});
const templates = [template("t1"), template("t2")];

vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  apiFetch: vi.fn(async () => templates),
  // These two call placeUtils' own apiFetch, so replacing the export above
  // does not reach them. Left real they fetched localhost, and the failure
  // logged while the worker was tearing down (setup-smoke's intermittent
  // EnvironmentTeardownError on "onUserConsoleLog").
  fetchCurrentUser: vi.fn(async () => ({}) as never),
  fetchComputeEstimate: vi.fn(async () => ({}) as never),
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
  switches.sharpen = false;
  submit.mockReset();
  cleanup();
  discard.mockClear();
  vi.mocked(apiFetch).mockImplementation(async () => templates as never);
  expect(network).not.toHaveBeenCalled();
});

function dialog(props: {
  open: boolean;
  awaitingBbox?: boolean;
  initialTemplateId?: string;
}) {
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

const templateSelect = () =>
  screen.getByLabelText("Template", { exact: true }) as HTMLSelectElement;

describe("TopoDialog, the template it was opened with", () => {
  // Mutation: drop `!initialTemplateApplied.current`, and the return from
  // drawing the area puts t1 back over the user's pick.
  it("survives a pick across drawing the area", async () => {
    const { rerender } = render(
      dialog({ open: true, initialTemplateId: "t1" }),
    );
    await vi.waitFor(() => expect(templateSelect().value).toBe("t1"));

    fireEvent.change(templateSelect(), { target: { value: "t2" } });
    rerender(
      dialog({ open: false, awaitingBbox: true, initialTemplateId: "t1" }),
    );
    rerender(dialog({ open: true, initialTemplateId: "t1" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(templateSelect().value).toBe("t2");
  });

  // Mutation: drop `if (!live) return`, and the list answering after the
  // dialog closed marks t1 applied, so the next open from t2 shows t1.
  it("applies on the next open after a close that beat the list", async () => {
    let answer: (list: TopoTemplate[]) => void = () => {};
    vi.mocked(apiFetch).mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)) as never,
    );
    const { rerender } = render(
      dialog({ open: true, initialTemplateId: "t1" }),
    );
    rerender(dialog({ open: false, initialTemplateId: "t1" }));
    answer(templates);
    await new Promise((resolve) => setTimeout(resolve, 0));

    rerender(dialog({ open: true, initialTemplateId: "t2" }));
    await vi.waitFor(() => expect(templateSelect().value).toBe("t2"));
  });
});

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

describe("TopoDialog once new jobs sharpen", () => {
  // Mutations: the old title, or a template picker for a job that draws no
  // styled layer a template could set.
  it("sharpens an area, with no template or style to choose", () => {
    switches.sharpen = true;
    render(dialog({ open: true }));
    expect(
      screen.getByRole("heading", { name: "Sharpen an area" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Template", { exact: true })).toBeNull();
    expect(screen.queryByText("How this topo is drawn")).toBeNull();
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
    switches.sharpen = true;
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

  // Mutation: drop the switch's gate on the template the dialog was opened
  // with, and the job is sent that template's style.
  it("applies no template, even the one it was opened with", async () => {
    switches.sharpen = true;
    const exporting = {
      ...template("t1"),
      config: {
        ...RASTER_TEMPLATE_DEFAULTS,
        vegetation: {
          ...RASTER_TEMPLATE_DEFAULTS.vegetation,
          denseColour: "#123456ff",
        },
      },
      autoExport: { ...AUTO_EXPORT_DEFAULTS, enabled: true },
    };
    vi.mocked(apiFetch).mockImplementation(async () => [exporting] as never);
    const { container } = render(
      dialog({ open: true, initialTemplateId: "t1" }),
    );
    pick(container, lazZip());
    await vegetationBox();
    submit.mockResolvedValue("job-1");
    fireEvent.click(screen.getByRole("button", { name: "Make it" }));
    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    const sent = submit.mock.calls[0]![1];
    expect(sent.settings).toEqual({
      ...RASTER_TEMPLATE_DEFAULTS,
      vegetation: { ...RASTER_TEMPLATE_DEFAULTS.vegetation, enabled: false },
    });
    expect(sent.autoExport.enabled).toBe(false);
  });
});

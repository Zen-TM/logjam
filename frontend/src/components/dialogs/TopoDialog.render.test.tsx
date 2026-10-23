import { RASTER_TEMPLATE_DEFAULTS } from "@logjam/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
}));

const discard = vi.fn();
vi.mock("./topoUpload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./topoUpload")>()),
  useTopoUpload: () => ({ submit: vi.fn(), discard, held: false }),
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
  cleanup();
  discard.mockClear();
  vi.mocked(apiFetch).mockImplementation(async () => templates as never);
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

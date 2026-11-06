import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MediaUpload from "./MediaUpload";

const mocks = vi.hoisted(() => ({
  uploadMedia: vi.fn(),
  toast: { done: vi.fn(), error: vi.fn() },
}));
vi.mock("../../placeUtils", () => ({ uploadMedia: mocks.uploadMedia }));
vi.mock("./mediaFiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mediaFiles")>()),
  generateThumbnail: async () => null,
}));
vi.mock("../feedback/ToastProvider", () => ({ useToast: () => mocks.toast }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function pick(files: File[]) {
  const view = render(
    <MediaUpload linkedType="place" linkedId="p1" onUploaded={vi.fn()} />,
  );
  const input = view.container.querySelector("input[type=file]")!;
  fireEvent.change(input, { target: { files } });
  return view;
}
const jpg = (name: string) => new File(["x"], name, { type: "image/jpeg" });
const mp4 = (name: string) => new File(["x"], name, { type: "video/mp4" });

describe("MediaUpload", () => {
  // Mutation: drop the toast call after the loop and a finished pick says
  // nothing; build the sentence here instead of attachSummary and it drifts
  // from Logjam GPS's.
  it("says what went in, in the sentence Logjam GPS uses", async () => {
    mocks.uploadMedia.mockResolvedValue({ id: "m" });
    pick([jpg("a.jpg"), jpg("b.jpg"), mp4("c.mp4")]);
    await waitFor(() =>
      expect(mocks.toast.done).toHaveBeenCalledWith(
        "2 photos and 1 video added.",
      ),
    );
  });

  // Mutation: replace the failure list with the toast alone, and the file's
  // name goes missing; toast the partial-failure sentence too and the failure
  // is said twice.
  it("toasts only what went in, and keeps listing a failed file by name", async () => {
    mocks.uploadMedia
      .mockResolvedValueOnce({ id: "m" })
      .mockRejectedValueOnce(new Error("too big"));
    const view = pick([jpg("a.jpg"), jpg("b.jpg")]);
    await waitFor(() =>
      expect(mocks.toast.done).toHaveBeenCalledWith("1 photo added."),
    );
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("b.jpg");
  });

  // Mutation: toast a failure sentence when every file fails.
  it("shows no toast when every file fails; the list says it", async () => {
    mocks.uploadMedia.mockRejectedValue(new Error("too big"));
    const view = pick([jpg("a.jpg"), jpg("b.jpg")]);
    await waitFor(() => expect(view.container.textContent).toContain("b.jpg"));
    expect(mocks.toast.done).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  // Mutation: size the noun from the file's name instead of the resolved kind.
  it("names a track through its real category", async () => {
    mocks.uploadMedia.mockResolvedValue({ id: "m" });
    pick([new File(["<gpx/>"], "descent.gpx", { type: "" })]);
    await waitFor(() =>
      expect(mocks.toast.done).toHaveBeenCalledWith("1 route added."),
    );
  });
});

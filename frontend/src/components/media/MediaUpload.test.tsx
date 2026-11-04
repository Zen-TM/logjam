import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MediaUpload from "./MediaUpload";

const mocks = vi.hoisted(() => ({
  uploadMedia: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "2 photos and 1 video added.",
      ),
    );
  });

  // Mutation: replace the failure list with the toast alone, and the file's
  // name goes missing.
  it("keeps listing a failed file by name", async () => {
    mocks.uploadMedia
      .mockResolvedValueOnce({ id: "m" })
      .mockRejectedValueOnce(new Error("too big"));
    const view = pick([jpg("a.jpg"), jpg("b.jpg")]);
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "1 of 2 added. 1 couldn't be added.",
      ),
    );
    expect(view.container.textContent).toContain("b.jpg");
  });
});

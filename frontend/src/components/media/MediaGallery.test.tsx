import { cleanup, render, screen } from "@testing-library/react";
import type { MediaItem } from "@logjam/shared";
import { afterEach, describe, expect, it } from "vitest";
import MediaGallery from "./MediaGallery";

afterEach(cleanup);

const track: MediaItem = {
  id: "t1",
  linkedType: "place",
  linkedId: "p1",
  mediaType: "application/gpx+xml",
  filename: "descent.gpx",
  fileSizeBytes: 10,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  displayUrl: "https://files.test/descent.gpx",
  thumbnailUrl: null,
  color: null,
  origin: null,
  displayName: null,
  metadata: {},
};

// frontend/DESIGN.md §3: a file to download is a `Row` with an href, and its
// one verb is behind the ⋯. Mutation that turns it red: draw the track as a
// bare anchor with its own delete button again.
describe("a track in the gallery is a row", () => {
  it("is a real link to the file, with its delete behind a menu", () => {
    render(
      <MediaGallery
        media={[track]}
        variant="tracks"
        canDelete
        onDeleted={() => {}}
      />,
    );
    const link = screen.getByRole("link", { name: "descent.gpx" });
    expect(link.getAttribute("href")).toBe("https://files.test/descent.gpx");
    expect(link.hasAttribute("download")).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Delete descent.gpx" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Actions for descent.gpx" }),
    ).toBeTruthy();
  });

  it("offers no menu to someone who cannot delete", () => {
    render(
      <MediaGallery
        media={[track]}
        variant="tracks"
        canDelete={false}
        onDeleted={() => {}}
      />,
    );
    expect(screen.getByRole("link", { name: "descent.gpx" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  IMPORT_ERRORS,
  IMPORT_SENTENCES,
  MEDIA_SIZE_CAPS,
  WAY_IMPORT,
} from "@logjam/shared";
import { importWayFile } from "./wayImport";
import { useWayImport } from "./useWayImport";

const api = vi.hoisted(() => ({ uploadMedia: vi.fn(async () => ({})) }));
vi.mock("../../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../placeUtils")>()),
  ...api,
}));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("../../feedback/ToastProvider", () => ({ useToast: () => toast }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Made-up coordinates; the name inside is not the file's name.
const GPX =
  '<gpx><trk><name>Made-up ridge</name><trkseg><trkpt lat="-33.1" lon="150.1"/>' +
  '<trkpt lat="-33.2" lon="150.3"/></trkseg></trk></gpx>';

const gpxFile = (name = "export-0001.gpx", text = GPX) =>
  new File([text], name, { type: "" });

describe("importWayFile", () => {
  it("stores the file untouched as a standalone import named for what is in it", async () => {
    const file = gpxFile();
    expect(await importWayFile(file)).toBe("Made-up ridge");
    expect(api.uploadMedia).toHaveBeenCalledWith({
      linkedType: "none",
      linkedId: null,
      origin: "import",
      displayName: "Made-up ridge",
      metadata: {
        bbox: [150.1, -33.2, 150.3, -33.1],
        featureCount: 1,
        positionCount: 2,
      },
      file,
      mediaType: "application/gpx+xml",
      thumbnail: null,
    });
  });

  // Mutation: parse after uploading, and an unreadable file is stored anyway.
  it("uploads nothing for a file it cannot read, or a format it does not take", async () => {
    await expect(importWayFile(gpxFile("a.gpx", "<gpx>"))).rejects.toThrow(
      IMPORT_ERRORS.unparseable,
    );
    await expect(
      importWayFile(new File(["a,b"], "places.csv")),
    ).rejects.toThrow(IMPORT_ERRORS.unsupportedExtension);
    expect(api.uploadMedia).not.toHaveBeenCalled();
  });
});

describe("importWayFile limits and failures", () => {
  // Mutation: delete the size check, and a file the API would refuse is read
  // and uploaded first.
  it("refuses a file over the track cap before reading or uploading it", async () => {
    const file = gpxFile();
    Object.defineProperty(file, "size", { value: MEDIA_SIZE_CAPS.track + 1 });
    const text = vi.spyOn(file, "text");
    await expect(importWayFile(file)).rejects.toThrow(IMPORT_ERRORS.tooLarge);
    expect(text).not.toHaveBeenCalled();
    expect(api.uploadMedia).not.toHaveBeenCalled();
  });

  // Mutation: drop the mapping, and a dead connection says "Couldn't import
  // that file." with no hint to check it.
  it("calls a storage PUT that got no answer a connection failure", async () => {
    api.uploadMedia.mockRejectedValueOnce(
      new Error("Upload failed (network error)"),
    );
    await expect(importWayFile(gpxFile())).rejects.toThrow("Network Error");
  });
});

describe("the picker", () => {
  const Harness = ({ onImported }: { onImported: () => void }) => {
    const { input } = useWayImport(onImported);
    return input;
  };
  const pick = (file: File) =>
    fireEvent.change(screen.getByTestId("way-import-input"), {
      target: { files: [file] },
    });

  it("takes GPX, KML and GeoJSON, tells where the file went, and refreshes the list", async () => {
    const onImported = vi.fn();
    render(<Harness onImported={onImported} />);
    expect(screen.getByTestId("way-import-input").getAttribute("accept")).toBe(
      ".gpx,.kml,.geojson",
    );
    pick(gpxFile());
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        WAY_IMPORT.saved("Made-up ridge"),
      ),
    );
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("says why when the file cannot be imported, and leaves the list alone", async () => {
    const onImported = vi.fn();
    render(<Harness onImported={onImported} />);
    pick(gpxFile("empty.gpx", "<gpx></gpx>"));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(IMPORT_SENTENCES.noFeatures),
    );
    expect(onImported).not.toHaveBeenCalled();
  });

  // Mutation: show `messageFromError`'s fallback instead of the API's sentence.
  it("shows the account's own sentence when the upload is refused", async () => {
    api.uploadMedia.mockRejectedValueOnce(
      new ApiError(507, "/media/presign", "POST", "Your storage is full."),
    );
    const onImported = vi.fn();
    render(<Harness onImported={onImported} />);
    pick(gpxFile());
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Your storage is full."),
    );
    expect(onImported).not.toHaveBeenCalled();
  });

  // Mutation: drop the busy flag, and a second pick starts a second upload.
  it("takes one import at a time", async () => {
    let finish!: () => void;
    api.uploadMedia.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve({}))),
    );
    render(<Harness onImported={vi.fn()} />);
    pick(gpxFile());
    await waitFor(() => expect(api.uploadMedia).toHaveBeenCalledTimes(1));
    expect(toast.info).toHaveBeenCalledWith("Importing…");
    pick(gpxFile("second.gpx"));
    finish();
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(api.uploadMedia).toHaveBeenCalledTimes(1);
  });
});

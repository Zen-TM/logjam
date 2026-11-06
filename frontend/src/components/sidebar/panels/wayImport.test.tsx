import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IMPORT_ERRORS, WAY_IMPORT } from "@logjam/shared";
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
      expect(toast.error).toHaveBeenCalledWith(IMPORT_ERRORS.noFeatures),
    );
    expect(onImported).not.toHaveBeenCalled();
  });
});

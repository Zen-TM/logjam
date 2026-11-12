import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

// The tree this phone's picker actually returns when Downloads is the only
// root on offer. The legacy expo-file-system SAF helpers reject every host but
// com.android.externalstorage, so a test that hands saveExportFile this tree
// and sees it succeed fails if saveExportFile goes back to them.
const DOWNLOADS_TREE =
  "content://com.android.providers.downloads.documents/tree/downloads";

const fs = vi.hoisted(() => {
  const written: { name: string; mimeType: string | null; text: string }[] = [];
  // `createdAs` is the name the provider's URI reports for the new file: the
  // requested name on external storage, a bare id on Downloads.
  const state = {
    createdAs: null as string | null,
    pick: "ok" as "ok" | "cancel",
  };
  const directory = {
    list: vi.fn(() => {
      throw new Error("list() is a synchronous call on the JS thread");
    }),
    createFile: (name: string, mimeType: string | null) => ({
      name: state.createdAs ?? name,
      write: async (text: string) => {
        written.push({ name, mimeType, text });
      },
    }),
  };
  const Directory = {
    pickDirectoryAsync: vi.fn(async () => {
      if (state.pick === "cancel") {
        throw Object.assign(new Error("cancelled"), {
          code: "ERR_PICKER_CANCELLED",
        });
      }
      return directory;
    }),
  };
  return { written, state, directory, Directory };
});
vi.mock("expo-file-system", () => ({ Directory: fs.Directory }));
vi.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: vi.fn(async () => "stored"),
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: vi.fn(async () => ({
      granted: true,
      directoryUri: DOWNLOADS_TREE,
    })),
    readDirectoryAsync: vi.fn(async (uri: string) => {
      if (!uri.includes("com.android.externalstorage")) {
        throw new Error(
          `The URI '${uri}' is not a Storage Access Framework URI.`,
        );
      }
      return [];
    }),
    createFileAsync: vi.fn(async () => {
      throw new Error("not a Storage Access Framework URI");
    }),
  },
  writeAsStringAsync: vi.fn(),
  EncodingType: { UTF8: "utf8" },
}));

const { exportRoute, exportStoredFile } = await import("./fileExport");

const STAMP = "2026-11-06 1432";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 6, 14, 32, 59)); // local time
  fs.written.length = 0;
  fs.state.createdAs = null;
  fs.state.pick = "ok";
});

afterEach(() => vi.useRealTimers());

const route = { name: "Claustral", points: [] };

describe("saving an export to a folder the user picks", () => {
  it("writes into a Downloads-only picker, which the legacy SAF helpers refuse", async () => {
    fs.state.createdAs = "1234"; // Downloads hands back a numeric id
    await expect(exportRoute(route, "gpx")).resolves.toBe(
      "to the folder you chose",
    );
    expect(fs.written).toHaveLength(1);
    expect(fs.written[0]).toMatchObject({
      name: `Claustral ${STAMP}.gpx`,
      mimeType: "application/gpx+xml",
    });
    expect(fs.written[0].text).toContain("<gpx");
  });

  it("names the file as the provider did, which may differ from the request", async () => {
    fs.state.createdAs = "Claustral (1).gpx";
    await expect(exportRoute(route, "gpx")).resolves.toBe("Claustral (1).gpx");
  });

  // Red if the stamp is dropped: a second export would clash and Android 10
  // would name it "Claustral.gpx (1)".
  it("puts the date and time to the minute before the extension, for every format", async () => {
    await exportRoute(route, "kml");
    expect(fs.written[0].name).toBe(`Claustral ${STAMP}.kml`);
    vi.setSystemTime(new Date(2026, 10, 6, 14, 33, 0));
    await exportRoute(route, "gpx");
    expect(fs.written[1].name).toBe("Claustral 2026-11-06 1433.gpx");
  });

  // Red if saveExportFile calls directory.list() again to pick a free name.
  it("leaves unique naming to the provider and never lists the folder", async () => {
    await exportRoute(route, "gpx");
    expect(fs.directory.list).not.toHaveBeenCalled();
  });

  it("treats a backed-out picker as no save, not an error", async () => {
    fs.state.pick = "cancel";
    await expect(exportRoute(route, "gpx")).resolves.toBeNull();
    expect(fs.written).toHaveLength(0);
  });

  it("lets any other picker failure through for the caller to report", async () => {
    fs.Directory.pickDirectoryAsync.mockRejectedValueOnce(new Error("boom"));
    await expect(exportRoute(route, "gpx")).rejects.toThrow("boom");
  });

  it("writes a stored file's text as read, under the name given", async () => {
    await exportStoredFile("/p/a.gpx", "a.gpx");
    expect(fs.written[0]).toMatchObject({
      name: `a ${STAMP}.gpx`,
      text: "stored",
    });
  });
});

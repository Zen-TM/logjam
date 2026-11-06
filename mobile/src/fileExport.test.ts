import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

// The tree this phone's picker actually returns when Downloads is the only
// root on offer. The legacy expo-file-system SAF helpers reject every host but
// com.android.externalstorage, so a test that hands saveExportFile this tree
// and sees it succeed fails if saveExportFile goes back to them.
const DOWNLOADS_TREE =
  "content://com.android.providers.downloads.documents/tree/downloads";

const fs = vi.hoisted(() => {
  const written: { name: string; mimeType: string | null; text: string }[] = [];
  const state = { existing: [] as string[], pick: "ok" as "ok" | "cancel" };
  const directory = {
    list: () => state.existing.map((name) => ({ name })),
    createFile: (name: string, mimeType: string | null) => ({
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
  return { written, state, Directory };
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

beforeEach(() => {
  fs.written.length = 0;
  fs.state.existing = [];
  fs.state.pick = "ok";
});

const route = { name: "Claustral", points: [] };

describe("saving an export to a folder the user picks", () => {
  it("writes into a Downloads-only picker, which the legacy SAF helpers refuse", async () => {
    await expect(exportRoute(route, "gpx")).resolves.toBe("Claustral.gpx");
    expect(fs.written).toHaveLength(1);
    expect(fs.written[0]).toMatchObject({
      name: "Claustral.gpx",
      mimeType: "application/gpx+xml",
    });
    expect(fs.written[0].text).toContain("<gpx");
  });

  it("puts the collision counter before the extension", async () => {
    fs.state.existing = ["Claustral.gpx", "Claustral (1).gpx"];
    await expect(exportRoute(route, "gpx")).resolves.toBe("Claustral (2).gpx");
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

  it("hands an imported file back byte for byte", async () => {
    await exportStoredFile("/p/a.gpx", "a.gpx");
    expect(fs.written[0]).toMatchObject({ name: "a.gpx", text: "stored" });
  });
});

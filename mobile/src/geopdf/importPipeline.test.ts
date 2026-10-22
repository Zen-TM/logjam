import { describe, expect, it, vi } from "vitest";

vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: vi.fn(async () => {}),
}));
// The copy into the import's folder fails, as on a full phone.
vi.mock("expo-file-system", () => ({
  Directory: class {
    uri = "file:///d/imports/geopdf/abc";
    exists = true;
  },
  File: class {
    size = 100;
    exists = false;
    copy() {
      throw new Error("no space");
    }
    delete() {}
  },
}));
vi.mock(
  "../../modules/logjam-pdf-renderer/src/LogjamPdfRendererModule",
  () => ({
    default: { sha256File: vi.fn(async () => "abc") },
  }),
);
vi.mock("../offline/localStores", () => ({
  IMPORTS_DIR: "file:///d/imports/",
  scratchFileUri: vi.fn(),
}));
vi.mock("../offline/freeSpace", () => ({
  NotEnoughSpaceError: class {},
  assertSpaceFor: vi.fn(async () => {}),
}));
vi.mock("../offline/registryDb", () => ({
  insertArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
}));
vi.mock("../imports/vectorImports", () => ({ randomId: () => "import-1" }));
vi.mock("../imports/stagedFile", () => ({
  stageIncomingFile: vi.fn(async ({ uri }: { uri: string }) => ({
    uri,
    scratch: null,
  })),
}));
vi.mock("../api/presignedTransfer", () => ({}));
const db = vi.hoisted(() => ({
  insertGeoPdfImport: vi.fn(async () => {}),
  findGeoPdfImportBySha256: vi.fn(async () => null),
  updateGeoPdfImport: vi.fn(async () => {}),
  deleteGeoPdfImportRow: vi.fn(),
  listGeoPdfImports: vi.fn(async () => []),
}));
vi.mock("./geoPdfImportsDb", () => db);

const { importGeoPdfFile } = await import("./importPipeline");

describe("importGeoPdfFile", () => {
  // Mutation: report the id only from buildArtifact. An import cancelled,
  // killed or failing during the copy keeps its row and the PDF, and a plan
  // never learns it is its own, so the plan's sweep misses it.
  it("reports the import's id once its row exists, before the copy", async () => {
    const reports: { phase: string; importId?: string }[] = [];
    await importGeoPdfFile(
      "Sheet.pdf",
      "file:///d/plans/p/g1.pdf",
      (progress) => reports.push(progress),
      { cancelled: false },
    ).catch(() => {});
    expect(db.insertGeoPdfImport).toHaveBeenCalled();
    expect(reports.find((report) => report.importId)).toMatchObject({
      phase: "copying",
      importId: "import-1",
    });
  });
});

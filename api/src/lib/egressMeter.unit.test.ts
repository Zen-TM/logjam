import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../services/prisma", () => ({
  default: {
    topoJob: { findMany: vi.fn() },
    topoExportJob: { findMany: vi.fn() },
    geoPdfJob: { findMany: vi.fn() },
  },
}));

import prisma from "../services/prisma";
import { tallyLogContents } from "./egressMeter";

const geoPdfFindMany = (prisma as unknown as { geoPdfJob: { findMany: Mock } })
  .geoPdfJob.findMany;

// One presigned download from the real-shape fixture, re-pointed at a GeoPDF.
const EXPORT_KEY =
  "exports/c9bf9e57-1685-4c89-bafb-ff5af830be8a/logjam-export.mbtiles";
const line = readFileSync(
  join(import.meta.dirname, "__fixtures__/s3-access-log-sample.log"),
  "utf8",
)
  .split("\n")
  .find((l) => l.includes(EXPORT_KEY))!
  .replaceAll(EXPORT_KEY, "exports/geo-pdf/pdf-1/logjam-export.pdf");

describe("tallyLogContents: GeoPDF downloads", () => {
  beforeEach(() => geoPdfFindMany.mockReset());

  it("charges an owned GeoPDF to its owner", async () => {
    geoPdfFindMany.mockResolvedValue([
      { id: "pdf-1", userId: "owner", chargedToId: null },
    ]);
    expect([...(await tallyLogContents([line])).keys()]).toEqual(["owner"]);
  });

  // Mutation: attribute a GeoPDF to `row.userId` alone in resolveOwners.
  it("charges a plan's GeoPDF to whoever its storage is charged to", async () => {
    geoPdfFindMany.mockResolvedValue([
      { id: "pdf-1", userId: null, chargedToId: "payer" },
    ]);
    expect([...(await tallyLogContents([line])).keys()]).toEqual(["payer"]);
  });

  it("drops a plan's GeoPDF charged to nobody", async () => {
    geoPdfFindMany.mockResolvedValue([
      { id: "pdf-1", userId: null, chargedToId: null },
    ]);
    expect((await tallyLogContents([line])).size).toBe(0);
  });
});

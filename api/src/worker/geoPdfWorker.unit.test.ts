import { describe, it, expect, vi, beforeEach } from "vitest";

const { db, send, generateGeoPdf, incrementStorageUsed } = vi.hoisted(() => ({
  db: {
    geoPdfJob: { findUnique: vi.fn(), updateMany: vi.fn() },
    user: { update: vi.fn(), findUnique: vi.fn() },
    notification: { create: vi.fn() },
    $transaction: vi.fn(),
    $disconnect: vi.fn(),
  },
  send: vi.fn(),
  generateGeoPdf: vi.fn(),
  incrementStorageUsed: vi.fn(),
}));

vi.mock("../services/prisma", () => ({ default: db }));
vi.mock("../services/awsClients", () => ({ s3: { send } }));
vi.mock("../lib/storageQuota", () => ({ incrementStorageUsed }));
vi.mock("../services/push", () => ({ sendPushToUser: vi.fn() }));
vi.mock("../services/email", () => ({ sendEmail: vi.fn() }));

// generateGeoPdf pulls in canvas/pdfkit/font registration — far too heavy
// (and irrelevant) for these claim/guard unit tests.
vi.mock("../services/generateGeoPdf", () => ({ generateGeoPdf }));

import {
  resultKeyFor,
  parseStoredConfig,
  parseStoredVectorStyle,
  processGeoPdfJob,
} from "./geoPdfWorker";
import { VECTOR_STYLE_DEFAULTS, type GeoPdfConfig } from "@logjam/shared";

function validConfig(): GeoPdfConfig {
  return {
    paperSize: "A4",
    orientation: "portrait",
    extent: { north: -33.4, south: -33.6, east: 150.4, west: 150.2 },
    scale: 25000,
    baseLayer: "osm",
    overlays: ["hillshade", "contours"],
    elements: { compass: true, scaleText: true, scaleBar: true },
  };
}

describe("resultKeyFor", () => {
  it("builds the exports/geo-pdf/{jobId}/logjam-export.pdf key", () => {
    expect(resultKeyFor("abc-123")).toBe(
      "exports/geo-pdf/abc-123/logjam-export.pdf",
    );
  });
});

describe("parseStoredConfig", () => {
  it("returns the config unchanged when it passes validateGeoPdfConfig", () => {
    const config = validConfig();
    expect(parseStoredConfig(config)).toEqual(config);
  });

  it("throws loudly when the stored config fails validation", () => {
    const bad = { ...validConfig(), baseLayer: "evil-tiles" };
    expect(() => parseStoredConfig(bad)).toThrow(/failed validation/);
  });

  it("throws on a non-object config", () => {
    expect(() => parseStoredConfig(null)).toThrow(/failed validation/);
  });
});

describe("parseStoredVectorStyle", () => {
  it("returns defaults when the snapshot is null", () => {
    expect(parseStoredVectorStyle(null)).toEqual(VECTOR_STYLE_DEFAULTS);
  });

  it("returns the parsed style when the snapshot is valid", () => {
    expect(parseStoredVectorStyle(VECTOR_STYLE_DEFAULTS)).toEqual(
      VECTOR_STYLE_DEFAULTS,
    );
  });

  it("falls back to defaults on an invalid stored snapshot (degraded, not fatal)", () => {
    const bad = {
      ...VECTOR_STYLE_DEFAULTS,
      contours: { ...VECTOR_STYLE_DEFAULTS.contours, majorColour: "#fff" },
    };
    expect(parseStoredVectorStyle(bad)).toEqual(VECTOR_STYLE_DEFAULTS);
  });
});

describe("processGeoPdfJob", () => {
  const pdf = Buffer.from("%PDF");

  beforeEach(() => {
    vi.clearAllMocks();
    db.geoPdfJob.findUnique.mockResolvedValue({
      id: "j1",
      userId: "u1",
      config: validConfig(),
      vectorStyleSnapshot: null,
    });
    db.user.findUnique.mockResolvedValue(null);
    generateGeoPdf.mockResolvedValue(pdf);
  });

  it("claims nothing and renders nothing when the job is no longer queued", async () => {
    db.geoPdfJob.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await processGeoPdfJob("j1")).toBe(0);
    expect(generateGeoPdf).not.toHaveBeenCalled();
  });

  // Mutations: charge storage through the outer prisma instead of through its
  // tx (the `tx` argument below); charge after the transaction has returned
  // (the charge-inside flag); charge before the status flip (the call order).
  it("charges storage inside the transaction that marks the job completed", async () => {
    const tx = { geoPdfJob: { updateMany: vi.fn() } };
    db.geoPdfJob.updateMany.mockResolvedValueOnce({ count: 1 });
    tx.geoPdfJob.updateMany.mockResolvedValueOnce({ count: 1 });
    // A flag rather than a call-order check alone: being handed `tx` after the
    // transaction has closed would still be a separate commit.
    let insideTransaction = false;
    let chargeSawOpenTransaction: boolean | null = null;
    incrementStorageUsed.mockImplementationOnce(async () => {
      chargeSawOpenTransaction = insideTransaction;
    });
    db.$transaction.mockImplementationOnce(async (fn) => {
      insideTransaction = true;
      try {
        return await fn(tx);
      } finally {
        insideTransaction = false;
      }
    });

    expect(await processGeoPdfJob("j1")).toBe(0);
    expect(tx.geoPdfJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "j1", status: "running" },
        data: expect.objectContaining({ status: "completed" }),
      }),
    );
    expect(incrementStorageUsed).toHaveBeenCalledWith(
      "u1",
      BigInt(pdf.length),
      tx,
    );
    expect(chargeSawOpenTransaction).toBe(true);
    expect(incrementStorageUsed.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.geoPdfJob.updateMany.mock.invocationCallOrder[0],
    );
  });

  it("charges nothing and deletes the upload when the job was reaped mid-render", async () => {
    const tx = { geoPdfJob: { updateMany: vi.fn() } };
    db.geoPdfJob.updateMany.mockResolvedValueOnce({ count: 1 });
    tx.geoPdfJob.updateMany.mockResolvedValueOnce({ count: 0 });
    db.$transaction.mockImplementationOnce((fn) => fn(tx));

    expect(await processGeoPdfJob("j1")).toBe(0);
    expect(incrementStorageUsed).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].constructor.name).toBe("DeleteObjectCommand");
  });
});

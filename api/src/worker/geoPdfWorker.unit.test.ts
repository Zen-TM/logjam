import { describe, it, expect, vi } from "vitest";

vi.mock("../services/prisma", () => ({
  default: {
    geoPdfJob: { findUnique: vi.fn(), updateMany: vi.fn() },
    user: { update: vi.fn() },
    notification: { create: vi.fn() },
    $transaction: vi.fn(),
    $disconnect: vi.fn(),
  },
}));

vi.mock("../services/awsClients", () => ({
  s3: { send: vi.fn() },
}));

// generateGeoPdf pulls in canvas/pdfkit/font registration — far too heavy
// (and irrelevant) for these claim/guard unit tests.
vi.mock("../services/generateGeoPdf", () => ({
  generateGeoPdf: vi.fn(),
}));

import {
  resultKeyFor,
  parseStoredConfig,
  parseStoredVectorStyle,
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
    const bad = { ...VECTOR_STYLE_DEFAULTS, contours: { ...VECTOR_STYLE_DEFAULTS.contours, majorColour: "#fff" } };
    expect(parseStoredVectorStyle(bad)).toEqual(VECTOR_STYLE_DEFAULTS);
  });
});

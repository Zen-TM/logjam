import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("./awsClients", () => ({ s3: { send: vi.fn() } }));
vi.mock("../lib/env", () => ({ getEnv: vi.fn(() => ({})) }));
// Stubbed so the unit test pulls in neither pino nor a validated real env
// (logger.ts calls getEnv() at module load, and errorHandler imports it too).
vi.mock("../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  safeErrorForLog: (err: unknown) => err,
}));

import { s3 } from "./awsClients";
import { getEnv } from "../lib/env";
import { getRopeWikiCanyons, clearRopeWikiCache } from "./ropeWikiCache";
import { AppError } from "../middleware/errorHandler";

const s3Send = (s3 as unknown as { send: Mock }).send;
const getEnvMock = getEnv as unknown as Mock;

// The real Special:Ask export, first four lines. Guards the parser against the
// header casing and cell formatting RopeWiki actually emits ("PAGEID" not
// "pageid", `15r` rappels, `229.659 ft`, HTML-wrapped ratings) rather than the
// tidied-up synthetic CSV the parser tests use.
const SAMPLE_CSV = readFileSync(
  join(__dirname, "__fixtures__", "ropewiki-nsw-sample.csv"),
  "utf8",
);

const LAST_MODIFIED = new Date("2026-06-19T11:25:00Z");

// `null` means "S3 returned no LastModified" — an explicit `undefined` would
// just re-select the default parameter.
function mockS3Object(csv: string, lastModified: Date | null = LAST_MODIFIED) {
  s3Send.mockResolvedValueOnce({
    Body: { transformToString: async () => csv },
    LastModified: lastModified ?? undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearRopeWikiCache();
  getEnvMock.mockReturnValue({ S3_BUCKET_MEDIA: "logjam-media-test" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getRopeWikiCanyons — S3 snapshot source", () => {
  it("parses the real-format snapshot and reports the source timestamp", async () => {
    mockS3Object(SAMPLE_CSV);

    const { canyons, errors, sourceUpdatedAt } = await getRopeWikiCanyons();

    expect(errors).toEqual([]);
    expect(canyons).toHaveLength(3);
    expect(sourceUpdatedAt).toEqual(LAST_MODIFIED);

    const claustral = canyons.find((c) => c.name === "Claustral Canyon");
    expect(claustral).toBeDefined();
    expect(claustral!.ropeWikiId).toBe(11672);
    // 33° 33' 33.12" S, 150° 24' 11.88" E
    expect(claustral!.latitude).toBeCloseTo(-33.5592, 4);
    expect(claustral!.longitude).toBeCloseTo(150.4033, 4);
    expect(claustral!.numAbseils).toBe(4); // "4-6r" → first number
    expect(claustral!.longestAbseil).toBe(15); // 49.213 ft → m
    expect(claustral!.vGrade).toBe(3);
    expect(claustral!.aGrade).toBe(2);
    expect(claustral!.commitment).toBe(3);
    expect(claustral!.quality).toBe(5);
  });

  it("reads the snapshot from reference/ropewiki-nsw.csv in the media bucket", async () => {
    mockS3Object(SAMPLE_CSV);
    await getRopeWikiCanyons();

    const command = s3Send.mock.calls[0][0];
    expect(command.input).toMatchObject({
      Bucket: "logjam-media-test",
      Key: "reference/ropewiki-nsw.csv",
    });
  });

  it("memoises — a second call inside the TTL does not re-read S3", async () => {
    mockS3Object(SAMPLE_CSV);

    const first = await getRopeWikiCanyons();
    const second = await getRopeWikiCanyons();

    expect(s3Send).toHaveBeenCalledTimes(1);
    expect(second.canyons).toEqual(first.canyons);
    expect(second.sourceUpdatedAt).toEqual(LAST_MODIFIED);
  });

  it("tolerates S3 omitting LastModified", async () => {
    mockS3Object(SAMPLE_CSV, null);
    expect((await getRopeWikiCanyons()).sourceUpdatedAt).toBeNull();
  });

  it("raises a 503 naming the fix when the snapshot is missing", async () => {
    s3Send.mockRejectedValueOnce(
      Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" }),
    );

    await expect(getRopeWikiCanyons()).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringContaining("reference/ropewiki-nsw.csv"),
    });
  });

  it("raises a 503 rather than a generic 500 when no bucket is configured", async () => {
    getEnvMock.mockReturnValue({ S3_BUCKET_MEDIA: undefined });

    const error = await getRopeWikiCanyons().catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(503);
    expect(s3Send).not.toHaveBeenCalled();
  });

  it("does not cache a failed load", async () => {
    s3Send.mockRejectedValueOnce(new Error("transient"));
    await expect(getRopeWikiCanyons()).rejects.toThrow();

    mockS3Object(SAMPLE_CSV);
    expect((await getRopeWikiCanyons()).canyons).toHaveLength(3);
  });
});

describe("getRopeWikiCanyons — fresh=true live path", () => {
  it("bypasses S3 and goes to RopeWiki", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => SAMPLE_CSV }),
    );

    const { canyons, sourceUpdatedAt } = await getRopeWikiCanyons(true);

    expect(s3Send).not.toHaveBeenCalled();
    expect(canyons).toHaveLength(3);
    expect(sourceUpdatedAt).toBeInstanceOf(Date);
  });

  it("surfaces the Cloudflare 403 as a 502, not an unhandled 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "" }),
    );

    await expect(getRopeWikiCanyons(true)).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining("HTTP 403"),
    });
  });
});

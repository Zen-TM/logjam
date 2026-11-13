import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/awsClients", () => ({ s3: { send: vi.fn() } }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(
    async (_s3: unknown, cmd: { input: { PartNumber: number } }) =>
      `url-${cmd.input.PartNumber}`,
  ),
}));

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../services/awsClients";
import {
  MAX_INPUT_ZIP_COMPRESSED_BYTES,
  MAX_INPUT_ZIP_UNCOMPRESSED_BYTES,
  TOPO_UPLOAD_PART_BYTES as PART,
  deleteTopoJobObjects,
  joinTopoUpload,
  signTopoParts,
} from "./topoUpload";

const send = (s3 as unknown as { send: Mock }).send;
const sentNames = () =>
  send.mock.calls.map(([cmd]) => cmd.constructor.name as string);
const s3Error = (name: string) => Object.assign(new Error(name), { name });

/** S3 answers each command by name; anything unlisted resolves {}. */
function answer(byName: Record<string, (input: unknown) => unknown>) {
  send.mockImplementation(async (cmd: { input: unknown }) => {
    const handler = byName[cmd.constructor.name];
    return handler ? handler(cmd.input) : {};
  });
}
const listing = (...sizes: number[]) => ({
  Parts: sizes.map((Size, i) => ({ PartNumber: i + 1, Size, ETag: `e${i}` })),
});

beforeEach(() => {
  send.mockReset().mockResolvedValue({});
  (getSignedUrl as Mock).mockClear();
});

describe("signTopoParts", () => {
  // Mutation: sign without ContentLength, or drop the Math.min, and a part of
  // any size uploads.
  it("signs each part's exact length: full parts, then the remainder", async () => {
    const parts = await signTopoParts("b", "k", "u", PART + 9, [1, 2]);
    expect(parts).toEqual([
      { partNumber: 1, url: "url-1" },
      { partNumber: 2, url: "url-2" },
    ]);
    const lengths = (getSignedUrl as Mock).mock.calls.map(
      ([, cmd]) => cmd.input.ContentLength,
    );
    expect(lengths).toEqual([PART, 9]);
  });

  // Mutation: drop the n > partCount check, and parts past the claimed size
  // get signed.
  it("refuses a part past the end of the file", async () => {
    await expect(signTopoParts("b", "k", "u", PART, [2])).rejects.toMatchObject(
      { statusCode: 400 },
    );
  });
});

describe("signTopoParts over the cap", () => {
  // Mutation: drop the cap check in signTopoParts, and a client claiming a
  // larger file gets up to S3's 10,000 parts signed.
  it("refuses a size over the cap", async () => {
    await expect(
      signTopoParts("b", "k", "u", MAX_INPUT_ZIP_COMPRESSED_BYTES + 1, [1]),
    ).rejects.toMatchObject({
      statusCode: 413,
      message:
        "That ZIP is larger than Logjam can take. Choose a smaller area.",
    });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  // Mutation: `>` to `>=` in signTopoParts' cap check.
  it("accepts a size of exactly the cap", async () => {
    await expect(
      signTopoParts("b", "k", "u", MAX_INPUT_ZIP_COMPRESSED_BYTES, [1]),
    ).resolves.toHaveLength(1);
  });
});

describe("joinTopoUpload", () => {
  it("joins full parts and a short last one", async () => {
    answer({ ListPartsCommand: () => listing(PART, PART, 5) });
    await joinTopoUpload("b", "k", "u", 3);
    const complete = send.mock.calls.find(
      ([cmd]) => cmd.constructor.name === "CompleteMultipartUploadCommand",
    )![0];
    expect(complete.input.MultipartUpload.Parts).toEqual([
      { PartNumber: 1, ETag: "e0" },
      { PartNumber: 2, ETag: "e1" },
      { PartNumber: 3, ETag: "e2" },
    ]);
  });

  // Mutation: drop the PartNumber check, and parts 1 and 3 join.
  it("refuses a count that matches with a part missing", async () => {
    answer({
      ListPartsCommand: () => ({
        Parts: [
          { PartNumber: 1, Size: PART, ETag: "a" },
          { PartNumber: 3, Size: 5, ETag: "c" },
        ],
      }),
    });
    await expect(joinTopoUpload("b", "k", "u", 2)).rejects.toMatchObject({
      statusCode: 400,
      message: "Part of that ZIP didn't upload. Try again.",
    });
    expect(sentNames()).not.toContain("CompleteMultipartUploadCommand");
  });

  // Mutation: drop the size check, and a 5 GiB part joins.
  it("aborts an upload whose parts are not the signed size", async () => {
    answer({ ListPartsCommand: () => listing(PART + 1, 5) });
    await expect(joinTopoUpload("b", "k", "u", 2)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(sentNames()).toContain("AbortMultipartUploadCommand");
    expect(sentNames()).not.toContain("CompleteMultipartUploadCommand");
  });

  // Mutation: drop the NoSuchUpload catch around the Complete send.
  it("a join that loses the race to another join still succeeds", async () => {
    answer({
      ListPartsCommand: () => listing(5),
      CompleteMultipartUploadCommand: () => {
        throw s3Error("NoSuchUpload");
      },
    });
    await joinTopoUpload("b", "k", "u", 1);
    expect(sentNames()).toContain("HeadObjectCommand");
  });

  it("an upload that is gone with no ZIP has expired", async () => {
    answer({
      ListPartsCommand: () => {
        throw s3Error("NoSuchUpload");
      },
      HeadObjectCommand: () => {
        throw s3Error("NotFound");
      },
    });
    await expect(joinTopoUpload("b", "k", "u", 1)).rejects.toMatchObject({
      statusCode: 400,
      message: "That upload expired. Choose the ZIP again.",
    });
  });

  it("answers S3's too-small part as a part that didn't upload, not a 500", async () => {
    answer({
      ListPartsCommand: () => listing(5),
      CompleteMultipartUploadCommand: () => {
        throw s3Error("EntityTooSmall");
      },
    });
    await expect(joinTopoUpload("b", "k", "u", 1)).rejects.toMatchObject({
      statusCode: 400,
      message: "Part of that ZIP didn't upload. Try again.",
    });
  });
});

describe("deleteTopoJobObjects", () => {
  // Mutation: drop the abort, or run it alongside the deletes.
  it("aborts the open upload before deleting anything", async () => {
    answer({
      ListMultipartUploadsCommand: () => ({
        Uploads: [{ Key: "inputs/j1/upload.zip", UploadId: "u1" }],
      }),
      ListObjectsV2Command: () => ({ Contents: [{ Key: "x" }] }),
    });
    await deleteTopoJobObjects("b", "j1");
    const names = sentNames();
    const abort = names.indexOf("AbortMultipartUploadCommand");
    expect(abort).toBeGreaterThan(-1);
    expect(send.mock.calls[abort][0].input).toMatchObject({
      Key: "inputs/j1/upload.zip",
      UploadId: "u1",
    });
    expect(names.indexOf("ListObjectsV2Command")).toBeGreaterThan(abort);
  });
});

describe("the topo worker's disk fits the upload caps", () => {
  // At its peak the worker holds the ZIP, its extraction, and the ground files
  // (uncompressed LAS) of the extracted point clouds. Those measured up to 0.75
  // of the extracted size for a forested, classified survey; open country or an
  // unclassified one is larger, and fails as "too big" instead (sharpen.py).
  // On top of that sit the pulled image, the TIN rasters, the tile files and
  // the archives being packed. ecs.tf is read as text: it is the value prod runs.
  const EXTRACTED_AND_GROUND_FACTOR = 1 + 0.75;
  const OVERHEAD_GIB = 10;
  const GiB = 1024 ** 3;

  // Mutation that turns it red: lower ephemeral_storage in the topo_worker
  // block of ecs.tf below 60, delete the block, or raise either cap in
  // topoUpload.ts without raising the disk.
  it("is no smaller than the ZIP, its extraction and ground files, and the overhead", () => {
    const ecs = readFileSync(
      join(import.meta.dirname, "../../../infra/terraform/envs/prod/ecs.tf"),
      "utf8",
    );
    const block =
      /resource "aws_ecs_task_definition" "topo_worker" \{[\s\S]*?\n\}/.exec(
        ecs,
      )?.[0];
    expect(block, "no topo_worker task definition in ecs.tf").toBeDefined();
    const gib = /ephemeral_storage \{\s*size_in_gib\s*=\s*(\d+)/.exec(
      block!,
    )?.[1];
    expect(gib, "topo_worker sets no ephemeral_storage").toBeDefined();
    expect(Number(gib) * GiB).toBeGreaterThanOrEqual(
      MAX_INPUT_ZIP_COMPRESSED_BYTES +
        EXTRACTED_AND_GROUND_FACTOR * MAX_INPUT_ZIP_UNCOMPRESSED_BYTES +
        OVERHEAD_GIB * GiB,
    );
  });
});

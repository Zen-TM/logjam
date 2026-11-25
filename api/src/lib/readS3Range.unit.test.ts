import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/awsClients", () => ({ s3: { send: vi.fn() } }));

import { s3 } from "../services/awsClients";
import { readS3Range } from "./readS3Range";

const send = s3.send as unknown as Mock;

/** An S3 response whose body records whether it was read or dropped. */
function response(fields: { ContentLength?: number; ContentRange?: string }) {
  const body = {
    transformToByteArray: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    destroy: vi.fn(),
  };
  return { body, res: { ...fields, Body: body } };
}

beforeEach(() => send.mockReset());

describe("readS3Range", () => {
  it("reads the range it asked for", async () => {
    const { body, res } = response({
      ContentLength: 4,
      ContentRange: "bytes 10-13/100",
    });
    send.mockResolvedValue(res);
    expect(await readS3Range("b", "k", 10, 14, 100)).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(send.mock.calls[0][0].input).toMatchObject({
      Bucket: "b",
      Key: "k",
      Range: "bytes=10-13",
    });
    expect(body.destroy).not.toHaveBeenCalled();
  });

  // Each case isolates one clause of the `if` in readS3Range; delete it and the
  // body is buffered (transformToByteArray called) instead of dropped.
  it.each([
    [
      "a longer body than the range",
      { ContentLength: 100, ContentRange: "bytes 10-13/100" },
    ],
    ["a whole-object 200 with no ContentRange", { ContentLength: 4 }],
    [
      "a different range than asked",
      { ContentLength: 4, ContentRange: "bytes 0-3/100" },
    ],
    [
      "another object size",
      { ContentLength: 4, ContentRange: "bytes 10-13/9999999999" },
    ],
  ])("drops %s unread", async (_name, fields) => {
    const { body, res } = response(fields);
    send.mockResolvedValue(res);
    await expect(readS3Range("b", "k", 10, 14, 100)).rejects.toMatchObject({
      code: "TRUNCATED",
    });
    expect(body.destroy).toHaveBeenCalled();
    expect(body.transformToByteArray).not.toHaveBeenCalled();
  });

  it("drops the body of an empty range without buffering it", async () => {
    // Mutation: delete `end <= start ||`. (S3 gets `bytes=5-4`, which it ignores.)
    const { body, res } = response({
      ContentLength: 0,
      ContentRange: "bytes 5-4/100",
    });
    send.mockResolvedValue(res);
    await expect(readS3Range("b", "k", 5, 5, 100)).rejects.toMatchObject({
      code: "TRUNCATED",
    });
    expect(body.transformToByteArray).not.toHaveBeenCalled();
  });
});

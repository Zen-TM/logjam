import { GetObjectCommand } from "@aws-sdk/client-s3";
import { truncatedZipError } from "@logjam/shared";
import { s3 } from "../services/awsClients";

/**
 * Bytes `start` to `end` (exclusive) of an object of `total` bytes. The
 * response is checked before its body is read: a range S3 ignored (an empty or
 * malformed one) answers with the whole object, which an upload cap allows to
 * be gigabytes, so anything but the range asked for is dropped unread.
 * Guard: readS3Range.unit.test.ts.
 */
export async function readS3Range(
  bucket: string,
  key: string,
  start: number,
  end: number,
  total: number,
): Promise<Uint8Array> {
  const res = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=${start}-${end - 1}`,
    }),
  );
  if (
    end <= start ||
    res.ContentLength !== end - start ||
    res.ContentRange !== `bytes ${start}-${end - 1}/${total}`
  ) {
    (res.Body as { destroy?: () => void } | undefined)?.destroy?.();
    throw truncatedZipError();
  }
  return res.Body!.transformToByteArray();
}

import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import { s3 } from "../services/awsClients";

export async function deleteS3Prefix(bucket: string, prefix: string): Promise<void> {
  try {
    let continuationToken: string | undefined;
    do {
      const listed: ListObjectsV2CommandOutput = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
      );
      const keys = listed.Contents?.map((o) => ({ Key: o.Key! })) ?? [];
      if (keys.length) {
        await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
      }
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
  } catch (err) {
    console.error({ bucket, prefix, err }, "s3_delete_prefix_failed");
  }
}

export async function deleteS3Keys(bucket: string, keys: string[]): Promise<void> {
  const valid = keys.filter((k): k is string => Boolean(k));
  if (!valid.length) return;
  try {
    for (let i = 0; i < valid.length; i += 1000) {
      const batch = valid.slice(i, i + 1000).map((k) => ({ Key: k }));
      await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch } }));
    }
  } catch (err) {
    console.error({ bucket, keyCount: valid.length, sampleKeys: valid.slice(0, 5), err }, "s3_delete_keys_failed");
  }
}

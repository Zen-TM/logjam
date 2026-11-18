// A way's file straight into a plan, as the account's own upload does it:
// presign, PUT to the signed URL, confirm. Online only; unlike the account's,
// nothing is queued, so a failure is the caller's to show and the file can be
// picked again.
import { uploadToPresignedUrl } from "../api/presignedTransfer";
import {
  confirmPlanFile,
  presignPlanFile,
  type PlanFileBody,
} from "./plansApi";
import { afterPlanWrite } from "./plansCache";

export async function uploadPlanFile(
  planId: string,
  file: { uri: string; sizeBytes: number } & PlanFileBody,
): Promise<void> {
  const { uri, sizeBytes, ...body } = file;
  const { mediaId, displayUploadUrl } = await presignPlanFile(planId, {
    ...body,
    sizeBytes,
  });
  const put = await uploadToPresignedUrl(displayUploadUrl, uri, {
    "Content-Type": body.mediaType,
  });
  if (put.status < 200 || put.status >= 300)
    throw new Error(`Upload failed (${put.status})`);
  await confirmPlanFile(planId, mediaId, body);
  await afterPlanWrite(planId);
}

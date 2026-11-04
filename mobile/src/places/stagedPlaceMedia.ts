// What the Add-a-place form holds while the place is still being made: photos
// and videos, and at most one way. Nothing is queued until the place is, so a
// cancelled form leaves no upload, link or route behind.
import { attachBatch } from "../media/attachBatch";
import type { PickedFile } from "../sync/mediaUpload";
import type { StagedWay } from "./AddWaySheet";

export type StagedMedia = { files: PickedFile[]; way: StagedWay | null };

export const NO_STAGED_MEDIA: StagedMedia = { files: [], way: null };

export const hasStagedMedia = (staged: StagedMedia) =>
  staged.files.length > 0 || staged.way !== null;

/**
 * Queue the staged picks against the place that was just queued. Each one
 * waits in the outbox for the place's create (`flush.ts`, `isLinkPending`), so
 * this works with no signal. One failure never costs the rest; it is reported
 * so the toast can say the place was added without all of them.
 */
export async function queueStagedMedia(
  placeId: string,
  staged: StagedMedia,
  attach: (file: PickedFile) => Promise<unknown>,
): Promise<{ failed: boolean }> {
  const { failed } = await attachBatch(staged.files, attach);
  let wayFailed = false;
  if (staged.way) {
    try {
      await staged.way.write(placeId);
    } catch (err) {
      console.error(err);
      wayFailed = true;
    }
  }
  return { failed: failed > 0 || wayFailed };
}

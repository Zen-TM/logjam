import type * as ImagePicker from "expo-image-picker";

import type { PickedFile } from "../sync/mediaUpload";

/**
 * Attach every picked file, one after another (each copies full-resolution
 * bytes and makes a thumbnail, so running them together would hold the whole
 * selection in memory). One bad file never costs the rest: it is counted and
 * the loop carries on.
 */
export async function attachBatch(
  files: PickedFile[],
  attachOne: (file: PickedFile) => Promise<unknown>,
): Promise<{ added: PickedFile[]; failed: number }> {
  const added: PickedFile[] = [];
  let failed = 0;
  for (const file of files) {
    try {
      await attachOne(file);
      added.push(file);
    } catch (err) {
      console.error(err);
      failed += 1;
    }
  }
  return { added, failed };
}

/** The library pick's options; a test holds the multi-select flag in place. */
export function libraryPickerOptions(mediaTypes: ImagePicker.MediaType[]) {
  return {
    mediaTypes,
    quality: 1,
    // Unlimited (selectionLimit 0): a photo is only queued, and the outbox
    // uploads when there is signal.
    allowsMultipleSelection: true,
  } satisfies ImagePicker.ImagePickerOptions;
}

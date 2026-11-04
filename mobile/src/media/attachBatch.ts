import { mediaCategory } from "@logjam/shared";
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

const NOUN = { image: "photo", video: "video", track: "route" } as const;

/** "2 photos and 1 video": what went in, by kind, in the order picked. */
function whatWasAdded(added: PickedFile[]): string {
  const counts = new Map<string, number>();
  for (const file of added) {
    const category = mediaCategory(file.mimeType ?? "image/jpeg");
    const noun = category ? NOUN[category] : "file";
    counts.set(noun, (counts.get(noun) ?? 0) + 1);
  }
  return [...counts]
    .map(([noun, n]) => `${n} ${noun}${n === 1 ? "" : "s"}`)
    .join(" and ");
}

/**
 * One toast for the whole pick: what went in, and how many didn't. A single
 * file that fails keeps the single-file wording; nothing to say when nothing
 * was picked. The sentence is under `message` so the copy scan
 * (`mobile/src/copyRules.test.ts`) reads it.
 */
export function attachSummary(
  added: PickedFile[],
  failed: number,
): { message: string; tone: "done" | "error" } | null {
  const total = added.length + failed;
  if (total === 0) return null;
  if (failed === 0)
    return { message: `${whatWasAdded(added)} added.`, tone: "done" };
  if (total === 1)
    return { message: "That file couldn't be attached.", tone: "error" };
  if (added.length === 0)
    return { message: `Couldn't add any of the ${total}.`, tone: "error" };
  return {
    message: `${added.length} of ${total} added. ${failed} couldn't be added.`,
    tone: "error",
  };
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

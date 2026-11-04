import { mediaCategory } from "@logjam/shared";

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

function noun(added: PickedFile[]): string {
  const categories = new Set(
    added.map((file) => mediaCategory(file.mimeType ?? "image/jpeg")),
  );
  const only = categories.size === 1 ? [...categories][0] : null;
  const one =
    only === "image"
      ? "photo"
      : only === "video"
        ? "video"
        : only === "track"
          ? "route"
          : "item";
  return added.length === 1 ? one : `${one}s`;
}

/**
 * One toast for the whole pick: what went in, and how many didn't. A single
 * file that fails keeps the single-file wording; nothing to say when nothing
 * was picked.
 */
export function attachSummary(
  added: PickedFile[],
  failed: number,
): { text: string; tone: "info" | "error" } | null {
  const total = added.length + failed;
  if (total === 0) return null;
  if (failed === 0)
    return {
      text: `${added.length} ${noun(added)} added.`,
      tone: "info",
    };
  if (total === 1)
    return { text: "That file couldn't be attached.", tone: "error" };
  if (added.length === 0)
    return { text: `None of the ${total} could be read.`, tone: "error" };
  return {
    text: `${added.length} of ${total} added. ${failed} couldn't be read.`,
    tone: "error",
  };
}

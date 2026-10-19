// Download for the trip (design §8): a plan's photos, files and GeoPDFs into
// its own app-private folder (`PLAN_DIR/<planId>/`), so the plan reads whole
// in a canyon. The plan's JSON is the cache's (`plansCache.ts`); these are
// the bytes it points at. A file is named by its item id, so a fresh fetch's
// new presigned URLs land on the same file.
//
// PRIVACY: other people's places and photos. App-private, wiped with the
// account (`offline/localStores.ts`), and a plan dropped from the phone takes
// its folder (`sweepPlanFolders`). Nothing here logs a URL or a path: a
// presigned URL is a bearer credential.
import * as FileSystem from "expo-file-system/legacy";
import type { TripPlanView } from "@logjam/shared";

import { downloadFromPresignedUrl } from "../api/presignedTransfer";
import { PLAN_DIR } from "../offline/localStores";

/** One file a plan points at, and where it comes from. */
export type PlanFile = {
  id: string;
  url: string;
  /** For the extension, so a viewer knows what it is. */
  filename: string;
  sizeBytes: number;
};

/** Every file Download for the trip fetches: place photos, standalone files,
 *  GeoPDFs. A GeoPDF with no URL yet (still rendering) is left out. */
export function planFiles(plan: TripPlanView): PlanFile[] {
  return [
    ...plan.places.flatMap((place) =>
      place.media.map((media) => ({
        id: media.id,
        url: media.displayUrl,
        filename: media.filename,
        sizeBytes: Number(media.sizeBytes),
      })),
    ),
    ...plan.files.map((file) => ({
      id: file.item.id,
      url: file.item.displayUrl,
      filename: file.item.filename,
      sizeBytes: Number(file.sizeBytes),
    })),
    ...plan.geoPdfs.flatMap((pdf) =>
      pdf.downloadUrl
        ? [
            {
              id: pdf.id,
              url: pdf.downloadUrl,
              filename: `${pdf.id}.pdf`,
              sizeBytes: Number(pdf.sizeBytes),
            },
          ]
        : [],
    ),
  ];
}

const folder = (planId: string) => `${PLAN_DIR}${encodeURIComponent(planId)}/`;

/** Where one of a plan's files lives on the phone. */
export function planFileUri(
  planId: string,
  file: Pick<PlanFile, "id" | "filename">,
) {
  const dot = file.filename.lastIndexOf(".");
  const ext = dot > 0 ? file.filename.slice(dot).replace(/[^.\w]/g, "") : "";
  return `${folder(planId)}${encodeURIComponent(file.id)}${ext}`;
}

/** The files of a plan not yet on the phone. */
export async function missingPlanFiles(
  planId: string,
  files: readonly PlanFile[],
): Promise<PlanFile[]> {
  const present = await Promise.all(
    files.map(async (file) => {
      const info = await FileSystem.getInfoAsync(planFileUri(planId, file));
      return info.exists;
    }),
  );
  return files.filter((_file, index) => !present[index]);
}

/**
 * Fetch every missing file, one at a time (a phone on a trailhead's signal,
 * not a CDN benchmark), reporting bytes done. A failed file throws and leaves
 * the ones already fetched for the next try.
 */
export async function downloadPlanFiles(
  planId: string,
  files: readonly PlanFile[],
  onProgress: (doneBytes: number) => void,
): Promise<void> {
  await FileSystem.makeDirectoryAsync(folder(planId), { intermediates: true });
  let done = 0;
  for (const file of files) {
    const uri = planFileUri(planId, file);
    const partial = `${uri}.part`;
    const result = await downloadFromPresignedUrl(file.url, partial);
    // The body is written whatever the status: an S3 error is not a photo.
    if (result.status !== 200) {
      await FileSystem.deleteAsync(partial, { idempotent: true });
      throw new Error(`plan file download failed (${result.status})`);
    }
    await FileSystem.moveAsync({ from: partial, to: uri });
    done += file.sizeBytes;
    onProgress(done);
  }
}

/** A plan's folder goes: it was left, deleted, or dropped from the phone. */
export async function deletePlanFolder(planId: string): Promise<void> {
  await FileSystem.deleteAsync(folder(planId), { idempotent: true });
}

/** Delete every plan folder whose plan is no longer cached. */
export async function sweepPlanFolders(keep: ReadonlySet<string>) {
  const info = await FileSystem.getInfoAsync(PLAN_DIR);
  if (!info.exists) return;
  const names = await FileSystem.readDirectoryAsync(PLAN_DIR);
  await Promise.all(
    names
      .filter((name) => !keep.has(decodeURIComponent(name)))
      .map((name) =>
        FileSystem.deleteAsync(`${PLAN_DIR}${name}`, { idempotent: true }),
      ),
  );
}

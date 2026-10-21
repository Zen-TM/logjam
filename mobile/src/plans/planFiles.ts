// Download for the trip: a plan's photos, files and GeoPDFs into its own
// app-private folder (`PLAN_DIR/<planId>/`), so they are on the phone in a
// canyon, where the plan's rows open them (`planFileSource`). The plan's JSON
// is the cache's (`plansCache.ts`); these are the bytes it points at. A file is named by its item id, so a fresh fetch's
// new presigned URLs land on the same file.
//
// PRIVACY: other people's places and photos. App-private, wiped with the
// account (`offline/localStores.ts`); a plan dropped from the phone takes its
// folder (`sweepPlanFolders`), and an item gone from a plan takes its file
// (`prunePlanFiles`). Nothing here logs a URL or a path: a presigned URL is a
// bearer credential.
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

/**
 * Where one of a plan's files opens from: the phone's copy once downloaded,
 * else its presigned URL while online. Null offline with no copy: its row
 * says "Needs a connection".
 */
export function planFileSource(
  planId: string,
  file: PlanFile | undefined,
  onPhone: ReadonlySet<string>,
  online: boolean,
): string | null {
  if (!file) return null;
  if (onPhone.has(file.id)) return planFileUri(planId, file);
  return online ? file.url : null;
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
 * the ones already fetched for the next try; its partial goes. `alive` is
 * asked before anything is written: false (the sign-out wipe) stops the run
 * with nothing more on disk, and it returns false.
 */
export async function downloadPlanFiles(
  planId: string,
  files: readonly PlanFile[],
  onProgress: (doneBytes: number) => void,
  alive: () => boolean,
): Promise<boolean> {
  if (!alive()) return false;
  await FileSystem.makeDirectoryAsync(folder(planId), { intermediates: true });
  let done = 0;
  for (const file of files) {
    if (!alive()) return false;
    const uri = planFileUri(planId, file);
    const partial = `${uri}.part`;
    const dropPartial = () =>
      FileSystem.deleteAsync(partial, { idempotent: true }).catch(() => {});
    let status: number;
    try {
      ({ status } = await downloadFromPresignedUrl(file.url, partial, (n) =>
        onProgress(done + Math.min(n, file.sizeBytes)),
      ));
    } catch (err) {
      await dropPartial();
      throw err;
    }
    // The body is written whatever the status: an S3 error is not a photo.
    if (status !== 200) {
      await dropPartial();
      throw new Error(`plan file download failed (${status})`);
    }
    if (!alive()) {
      await dropPartial();
      return false;
    }
    await FileSystem.moveAsync({ from: partial, to: uri });
    done += file.sizeBytes;
    onProgress(done);
  }
  return true;
}

/** Delete what the plan no longer points at: a removed item's file, and a
 *  partial left by a failed run of a file that has gone since. */
export async function prunePlanFiles(
  planId: string,
  files: readonly PlanFile[],
): Promise<void> {
  const dir = folder(planId);
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return;
  const keep = new Set(
    files.flatMap((file) => {
      const name = planFileUri(planId, file).slice(dir.length);
      return [name, `${name}.part`];
    }),
  );
  const names = await FileSystem.readDirectoryAsync(dir);
  await Promise.all(
    names
      .filter((name) => !keep.has(name))
      .map((name) =>
        FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true }),
      ),
  );
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

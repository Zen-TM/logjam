// Download for the trip: a plan's photos, files and GeoPDFs into its own
// app-private folder (`PLAN_DIR/<planId>/`), so they are on the phone in a
// canyon, where the plan's rows open them (`planFileSource`). The plan's JSON
// is the cache's (`plansCache.ts`); these are the bytes it points at. A file
// is named by its item id, so a fresh fetch's new presigned URLs land on the
// same file.
//
// PRIVACY: other people's places, photos and maps. App-private, wiped with
// the account (`offline/localStores.ts`). A plan dropped from the phone (left,
// removed, deleted) takes its folder, and with it any of its GeoPDFs put on
// the map (`linkPlanGeoPdfImport`, `sweepPlanFolders`); an item gone from a
// plan takes its file and its import (`prunePlanFiles`). Keeping one is Save
// a copy. Nothing here logs a URL or a path: a presigned URL is a bearer
// credential.
import * as FileSystem from "expo-file-system/legacy";
import type { TripPlanPlace, TripPlanView } from "@logjam/shared";

import { downloadFromPresignedUrl } from "../api/presignedTransfer";
import {
  deleteGeoPdfImport,
  type GeoPdfProgress,
} from "../geopdf/importPipeline";
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
    ...plan.places.flatMap(placeFiles),
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

/** A plan place's photos, as files. */
export function placeFiles(place: TripPlanPlace): PlanFile[] {
  return place.media.map((media) => ({
    id: media.id,
    url: media.displayUrl,
    filename: media.filename,
    sizeBytes: Number(media.sizeBytes),
  }));
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

/** The media that can open now, each given where it opens from as the
 *  viewer's `localDisplayPath`. */
export function openablePlanMedia<T extends { id: string }>(
  planId: string,
  items: readonly T[],
  files: readonly PlanFile[],
  onPhone: ReadonlySet<string>,
  online: boolean,
): (T & { localDisplayPath: string })[] {
  return items.flatMap((item) => {
    const file = files.find((each) => each.id === item.id);
    const uri = planFileSource(planId, file, onPhone, online);
    return uri ? [{ ...item, localDisplayPath: uri }] : [];
  });
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

/** Which of a plan's GeoPDFs are on the map, as plan item id → GeoPDF
 *  import id. In the plan's folder, so the imports go with it. */
const IMPORTS = "geopdf-imports.json";

async function readImports(dir: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(`${dir}${IMPORTS}`));
  } catch {
    return {};
  }
}

/** A plan's GeoPDF went onto the map as a new import: it is the plan's, and
 *  goes when the plan leaves the phone or the GeoPDF leaves the plan. */
export async function linkPlanGeoPdfImport(
  planId: string,
  geoPdfId: string,
  importId: string,
): Promise<void> {
  const dir = folder(planId);
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const imports = await readImports(dir);
  imports[geoPdfId] = importId;
  await FileSystem.writeAsStringAsync(
    `${dir}${IMPORTS}`,
    JSON.stringify(imports),
  );
}

/**
 * An import's progress, linking its record to the plan on the first id it
 * reports. That is before the render that can fail or be killed, so a failed
 * or interrupted import is swept with the plan too, never left to be resumed
 * from Saved as the caller's own. A finished import of the same bytes is
 * returned without an id and left alone; an unfinished one is resumed and
 * claimed, even one the caller began themselves.
 */
export function linkingProgress(
  planId: string,
  geoPdfId: string,
  onProgress: (progress: GeoPdfProgress) => void,
): (progress: GeoPdfProgress) => void {
  let linked = false;
  return (progress) => {
    if (progress.importId && !linked) {
      linked = true;
      void linkPlanGeoPdfImport(planId, geoPdfId, progress.importId).catch(
        console.error,
      );
    }
    onProgress(progress);
  };
}

/** A plan's folder goes, with the GeoPDF imports it names. */
async function dropFolder(dir: string): Promise<void> {
  for (const importId of Object.values(await readImports(dir)))
    await deleteGeoPdfImport(importId).catch(console.error);
  await FileSystem.deleteAsync(dir, { idempotent: true });
}

/** Delete what the plan no longer points at: a removed item's file and its
 *  import, and a partial left by a failed run of a file that has gone since. */
export async function prunePlanFiles(
  planId: string,
  files: readonly PlanFile[],
): Promise<void> {
  const dir = folder(planId);
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return;
  const ids = new Set(files.map((file) => file.id));
  const imports = await readImports(dir);
  const gone = Object.keys(imports).filter((id) => !ids.has(id));
  if (gone.length > 0) {
    for (const id of gone) {
      await deleteGeoPdfImport(imports[id]).catch(console.error);
      delete imports[id];
    }
    await FileSystem.writeAsStringAsync(
      `${dir}${IMPORTS}`,
      JSON.stringify(imports),
    );
  }
  const keep = new Set([
    IMPORTS,
    ...files.flatMap((file) => {
      const name = planFileUri(planId, file).slice(dir.length);
      return [name, `${name}.part`];
    }),
  ]);
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
  await dropFolder(folder(planId));
}

/** Delete every plan folder whose plan is no longer cached. */
export async function sweepPlanFolders(keep: ReadonlySet<string>) {
  const info = await FileSystem.getInfoAsync(PLAN_DIR);
  if (!info.exists) return;
  const names = await FileSystem.readDirectoryAsync(PLAN_DIR);
  await Promise.all(
    names
      .filter((name) => !keep.has(decodeURIComponent(name)))
      .map((name) => dropFolder(`${PLAN_DIR}${name}/`)),
  );
}

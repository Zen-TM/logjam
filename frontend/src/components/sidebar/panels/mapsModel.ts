// What the Maps page says about each map, out of the component so it is checked
// (DESIGN.md §9).
//
// The page answers "what maps have I made, and what is still being made?"
// (DESIGN.md §1). The second half of that question is `beingMade`: every job the
// user is still waiting on — a GeoPDF, a topo, an export of a topo — as one kind
// of row, newest first, with the words for where it has got to. It used to be a
// stack of coloured ribbons over the page with a "TOPO"/"EXPORT · GPKG" chip on
// each, capped at three behind a "Show all"; the tile's glyph and hue already
// say which kind a row is, and a list that scrolls has no reason to hide its
// fourth item.
import {
  EXPORT_FORMAT_RULES,
  formatBytes,
  formatMinutes,
  type GeoPdfJobView,
  type TopoExportJobView,
} from "@logjam/shared";
import { FileDown, FileText, LayoutTemplate, Mountain, type LucideIcon } from "lucide-react";
import type { CompletedTopoJob } from "../../../topoLayerTypes";
import type { TopoJob } from "../../dialogs/TopoDialog";

/**
 * A kind's glyph and hue (DESIGN.md §3), from Logjam GPS's Saved tab: a GeoPDF
 * is a page of paper, a LiDAR topo is terrain in the eucalypt `overlay` hue.
 * What is made FROM a thing wears that thing's hue with its own glyph — an
 * export is a file out of a topo, a template is the settings a map is made
 * with — so a row says both what it is and what it belongs to.
 */
export const MAP_IDENTITY: Record<"geoPdf" | "topo" | "export" | "geoPdfTemplate" | "topoTemplate", {
  icon: LucideIcon;
  hue: string;
  label: string;
}> = {
  geoPdf: { icon: FileText, hue: "var(--hue-geoPdf)", label: "GeoPDF" },
  topo: { icon: Mountain, hue: "var(--hue-overlay)", label: "LiDAR topo" },
  export: { icon: FileDown, hue: "var(--hue-overlay)", label: "Export of a LiDAR topo" },
  geoPdfTemplate: { icon: LayoutTemplate, hue: "var(--hue-geoPdf)", label: "GeoPDF template" },
  topoTemplate: { icon: LayoutTemplate, hue: "var(--hue-overlay)", label: "LiDAR topo template" },
};

export const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Hand a finished file to the browser. The URL is presigned and short-lived,
 * which is why the list is refetched rather than the link kept.
 */
export function downloadFile(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "";
  anchor.click();
}

/** One job still on its way, whichever kind it is. */
export type MakingItem = {
  key: string;
  kind: "geoPdf" | "topo" | "export";
  id: string;
  title: string;
  /** Where it has got to, in words ("Queued", "Processing · about 21 min"). */
  detail: string;
  failed: boolean;
  createdAt: string;
};

/** "8 Sept 2026". A true timestamp, so local time is right (frontend/CLAUDE.md). */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** "8 Sept 2026, 3:41 pm" — for a name made from a date, where two made the
 *  same day would otherwise read identically (GEOPDF-2). */
function formatDayAndTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A GeoPDF's name: its map title, or when it was made. */
export function geoPdfLabel(job: Pick<GeoPdfJobView, "title" | "createdAt">): string {
  return job.title ?? `GeoPDF · ${formatDayAndTime(job.createdAt)}`;
}

/** A topo's name: what the user called it, or the day it was made. */
export function topoLabel(job: { name: string | null; createdAt: string }): string {
  return job.name ?? formatDay(job.createdAt);
}

/** "GeoTIFF", from the one declaration of what the formats are called. */
export function exportFormatLabel(format: TopoExportJobView["format"]): string {
  return EXPORT_FORMAT_RULES[format].label;
}

/** An export is named after the topo it was made from — which may be gone. */
export function exportLabel(
  exportJob: Pick<TopoExportJobView, "sourceJobIds">,
  topoNames: ReadonlyMap<string, string>,
): string {
  return topoNames.get(exportJob.sourceJobIds[0]) ?? "Deleted topo";
}

/** Every completed topo's name, by id, for naming the exports made from them. */
export function topoNamesById(jobs: readonly CompletedTopoJob[]): Map<string, string> {
  return new Map(jobs.map((job) => [job.jobId, topoLabel(job)]));
}

/** A finished file's line under its title: size, then the day it was made. */
export function fileSubtitle(parts: { format?: string; bytes: number | null; createdAt: string }): string {
  return [parts.format, parts.bytes != null ? formatBytes(parts.bytes) : null, formatDay(parts.createdAt)]
    .filter(Boolean)
    .join(" · ");
}

const FAILED = "Couldn't be made";

/** "Making · about 5 min", or the verb alone while no estimate exists (rows
 *  made before the estimator, or a zero). */
function withEstimate(verb: string, estimatedSeconds: number | null): string {
  return estimatedSeconds != null && estimatedSeconds > 0 ? `${verb} · ${formatMinutes(estimatedSeconds)}` : verb;
}

export function geoPdfsBeingMade(jobs: readonly GeoPdfJobView[]): MakingItem[] {
  return newestFirst(
    jobs
      .filter((job) => job.status !== "completed")
      .map((job) => ({
        key: `geoPdf-${job.id}`,
        kind: "geoPdf" as const,
        id: job.id,
        title: geoPdfLabel(job),
        detail:
          job.status === "queued"
            ? "Queued"
            : job.status === "running"
              ? withEstimate("Making", job.estimatedSeconds)
              : (job.errorMessage ?? FAILED),
        failed: job.status === "failed",
        createdAt: job.createdAt,
      })),
  );
}

/** Topos still on their way AND exports of finished topos still on theirs: one
 *  list, because to the person waiting they are the same kind of wait. */
export function topoWorkBeingMade(
  activeTopoJobs: readonly TopoJob[],
  exports: readonly TopoExportJobView[],
  topoNames: ReadonlyMap<string, string>,
): MakingItem[] {
  const topos = activeTopoJobs.map((job) => ({
    key: `topo-${job.id}`,
    kind: "topo" as const,
    id: job.id,
    title: topoLabel(job),
    detail:
      job.status === "uploading"
        ? "Uploading"
        : job.status === "pending"
          ? "Queued"
          : job.status === "processing"
            ? withEstimate("Processing", job.estimatedSeconds)
            : (job.errorMessage ?? FAILED),
    failed: job.status === "failed",
    createdAt: job.createdAt,
  }));
  const exporting = exports
    .filter((exportJob) => exportJob.status !== "completed")
    .map((exportJob) => {
      const format = exportFormatLabel(exportJob.format);
      return {
        key: `export-${exportJob.id}`,
        kind: "export" as const,
        id: exportJob.id,
        title: exportLabel(exportJob, topoNames),
        detail:
          exportJob.status === "queued"
            ? `Export as ${format} · Queued`
            : exportJob.status === "running"
              ? withEstimate(`Exporting as ${format}`, exportJob.estimatedSeconds)
              : (exportJob.errorMessage ?? FAILED),
        failed: exportJob.status === "failed",
        createdAt: exportJob.createdAt,
      };
    });
  return newestFirst([...topos, ...exporting]);
}

/** Newest first, and stable: two made in the same second keep their order. */
export function newestFirst<T extends { createdAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

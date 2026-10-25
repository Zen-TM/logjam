// What the Maps page says about each map, out of the component so it is checked
// (DESIGN.md).
//
// The page answers "what maps have I made, and what is still being made?"
// (shared/DESIGN.md §2). The second half of that question is `beingMade`: every job the
// user is still waiting on — a GeoPDF or a topo — as one kind
// of row, newest first, with the words for where it has got to. The tile's glyph
// and hue already say which kind a row is, and a list that scrolls has no
// reason to hide its fourth item.
import {
  formatBytes,
  formatMinutes,
  type GeoPdfJobView,
  LIDAR_JOB_COPY,
} from "@logjam/shared";
import type { TopoJob } from "../../dialogs/TopoDialog";
import { type Glyph } from "../../../ui";

/**
 * A kind's glyph and hue (shared/DESIGN.md §8), from Logjam GPS's Saved tab: a GeoPDF
 * is a page of paper, a LiDAR topo is terrain in the eucalypt `overlay` hue.
 * What is made FROM a thing wears that thing's hue with its own glyph — a
 * template is the settings a map is made with — so a row says both what it is
 * and what it belongs to.
 */
export const MAP_IDENTITY: Record<
  "geoPdf" | "topo" | "sharpened" | "geoPdfTemplate",
  {
    icon: Glyph;
    hue: string;
    label: string;
  }
> = {
  geoPdf: { icon: "geoPdf", hue: "var(--hue-geo-pdf)", label: "GeoPDF" },
  topo: {
    icon: "lidar",
    hue: "var(--hue-overlay)",
    label: "LiDAR topo",
  },
  // A finished LiDAR job: the Terrain layers made sharper over its area.
  sharpened: {
    icon: "lidar",
    hue: "var(--hue-overlay)",
    label: LIDAR_JOB_COPY.noun,
  },
  geoPdfTemplate: {
    icon: "template",
    hue: "var(--hue-geo-pdf)",
    label: "GeoPDF template",
  },
};

export const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

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
  kind: "geoPdf" | "topo";
  id: string;
  title: string;
  /** Where it has got to, in words ("Queued", "Processing · about 21 min"). */
  detail: string;
  failed: boolean;
  createdAt: string;
};

/** "8 Sept 2026". A true timestamp, so local time is right (frontend/CLAUDE.md). */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "8 Sept 2026, 3:41 pm" — for a name made from a date, where two made the
 *  same day would otherwise read identically. */
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
export function geoPdfLabel(
  job: Pick<GeoPdfJobView, "title" | "createdAt">,
): string {
  return job.title ?? `GeoPDF · ${formatDayAndTime(job.createdAt)}`;
}

/** A topo's name: what the user called it, or the day it was made. */
export function topoLabel(job: {
  name: string | null;
  createdAt: string;
}): string {
  return job.name ?? formatDay(job.createdAt);
}

/** A finished file's line under its title: size, then the day it was made. */
export function fileSubtitle(parts: {
  format?: string;
  bytes: number | null;
  createdAt: string;
}): string {
  return [
    parts.format,
    parts.bytes != null ? formatBytes(parts.bytes) : null,
    formatDay(parts.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");
}

const FAILED = "Couldn't be made";

/** "Making · about 5 min", or the verb alone while no estimate exists (rows
 *  made before the estimator, or a zero). */
function withEstimate(verb: string, estimatedSeconds: number | null): string {
  return estimatedSeconds != null && estimatedSeconds > 0
    ? `${verb} · ${formatMinutes(estimatedSeconds)}`
    : verb;
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

export function toposBeingMade(
  activeTopoJobs: readonly TopoJob[],
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
  return newestFirst(topos);
}

/** Newest first, and stable: two made in the same second keep their order. */
export function newestFirst<T extends { createdAt: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

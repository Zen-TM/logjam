// What Logjam Web's vector basemap and snapping read: the archive of the
// region the map shows (ADR 0049), always same-origin (prod serves /master/*
// from the web distribution, the dev server proxies the same prefix: see
// vite.config.ts), so it stays under CSP 'self' and out of CORS.
import { layers, namedFlavor } from "@protomaps/basemaps";
import {
  REGIONS,
  regionInView,
  snapArchiveFor,
  vectorIn,
  WORLD,
  type LonLatBox,
  type Region,
  type RoutePoint,
  type VectorArchive,
} from "@logjam/shared";

/** The source URL for an archive, as MapLibre's pmtiles protocol reads it. */
export const vectorSourceUrl = (archive: VectorArchive, origin: string) =>
  `pmtiles://${origin}/${archive.archivePath}`;

/**
 * The archive the vector source is created with, before the map has reported a
 * region: that of the region in `view`, else the first any region declares. A
 * view with none offers no vector map, so its layers stay hidden and the source
 * only has to exist for them; the effect that follows the region in view points
 * it at the right archive once there is one. Guard: `vectorBasemap.test.ts`
 * ("initialVectorArchive").
 */
export function initialVectorArchive(
  view: LonLatBox,
  regions: readonly Region[] = REGIONS,
  world: Region = WORLD,
): VectorArchive {
  return (
    vectorIn(regionInView(view, regions, world)) ??
    regions.flatMap((region) => region.vector ?? [])[0]!
  );
}

/** The URL a segment snaps to, or null where its region has no archive to snap to. */
export function snapUrlFor(
  from: RoutePoint,
  to: RoutePoint,
  origin: string,
): string | null {
  const archive = snapArchiveFor(from, to);
  return archive ? `${origin}/${archive.archivePath}` : null;
}

/**
 * The Protomaps style's layers, bound to `source`, with labels in `lang`
 * where the data has a name in it. Light flavor only: Logjam Web has no dark
 * theme (index.css carries a single prefers-color-scheme rule that inverts
 * icons, nothing more).
 */
export const vectorStyleLayers = (source: string, lang = "en") =>
  layers(source, namedFlavor("light"), { lang });

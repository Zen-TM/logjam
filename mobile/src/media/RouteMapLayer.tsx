import { useEffect, useState } from "react";
import * as FileSystem from "expo-file-system";
import { LineLayer, ShapeSource } from "@maplibre/maplibre-react-native";
import { parseVectorImport, type ImportedFeature } from "@logjam/shared";

import { theme } from "../theme";
import { ensureDisplayCached } from "../sync/mediaCache";

/**
 * A route attachment (.gpx/.kml) drawn on the map as a TRANSIENT layer.
 *
 * Deliberately not an import: "show me where this trip went" is a look, not an
 * acquisition. Routing it through `importVectorSource` would add a permanent
 * row to Saved every time the user glanced at a trip, so this parses the cached
 * file in memory, draws it, and forgets it when dismissed. The file itself is
 * already on the device via the media cache, so a second look costs nothing and
 * works offline.
 *
 * PRIVACY: the parsed geometry stays in component state; nothing about it is
 * logged, and the failure path reports only that the file couldn't be read.
 */
export type RouteRequest = {
  mediaId: string;
  filename: string;
  /**
   * The on-device copy, when there is one. An attachment that hasn't uploaded
   * yet exists ONLY locally — asking the cache to fetch it would fail, and
   * "look at the route I just recorded" is exactly the case that must work.
   */
  localPath?: string | null;
  /** Bumped per request, so re-showing the same route refocuses the camera. */
  nonce: number;
};

export function RouteMapLayer({
  request,
  onLoaded,
  onFailed,
}: {
  request: RouteRequest;
  /** Reports the route's extent so the caller can fit the camera to it. */
  onLoaded: (bbox: [number, number, number, number]) => void;
  onFailed: (message: string) => void;
}) {
  const [features, setFeatures] = useState<ImportedFeature[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFeatures(null);
    (async () => {
      const uri = request.localPath ?? (await ensureDisplayCached(request.mediaId));
      if (uri === null) throw new Error("route file not cached");
      const text = await FileSystem.readAsStringAsync(uri);
      const parsed = parseVectorImport(request.filename, text);
      if (cancelled) return;
      setFeatures(parsed.features);
      onLoaded(parsed.bbox);
    })().catch((err: unknown) => {
      console.error(err);
      if (!cancelled) {
        onFailed("Couldn't read that route file. It may not be downloaded yet.");
      }
    });
    return () => {
      cancelled = true;
    };
    // Keyed on the request identity: a new nonce means "show it again".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.localPath, request.mediaId, request.nonce]);

  if (features === null || features.length === 0) return null;

  return (
    <ShapeSource
      id="trip-route"
      shape={{ type: "FeatureCollection", features: features as never }}
    >
      {/* A casing under the line so it stays readable over both the pale topo
          basemap and dark satellite imagery. */}
      <LineLayer
        id="trip-route-casing"
        style={{
          lineColor: theme.primary,
          lineWidth: 7,
          lineOpacity: 0.7,
          lineCap: "round",
          lineJoin: "round",
        }}
      />
      <LineLayer
        id="trip-route-line"
        style={{
          lineColor: ROUTE_COLOR,
          lineWidth: 3.5,
          lineCap: "round",
          lineJoin: "round",
        }}
      />
    </ShapeSource>
  );
}

/** Distinct from the recorded-track palette so a viewed route reads as "not mine
 * to edit" rather than as another live recording. */
export const ROUTE_COLOR = "#E8C07D";

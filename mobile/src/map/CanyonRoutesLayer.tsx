// "Canyon routes" — every route attachment on the account, drawn at once.
//
// Web parity (its map has a canyon-tracks layer); mobile until now could only
// show one route at a time, transiently, from a canyon's own screen. This is the
// standing layer version, and it lives behind a toggle in the layers sheet
// because it is a lot of ink to add to a map unasked.
//
// ONE ShapeSource, not one per route: each parsed file's features are merged into
// a single collection carrying a `routeColor` property, and the line layers read
// that with a data-driven style. Fifty sources would be fifty native layer
// commits every time the collection changed.
//
// It reads the MIRROR and the media cache, so it works with no signal — but only
// for files this phone has actually fetched. It reports how many it could not
// read rather than quietly drawing a partial picture.
import { useEffect, useState } from "react";
import * as FileSystem from "expo-file-system";
import { CircleLayer, LineLayer, ShapeSource } from "@maplibre/maplibre-react-native";
import { TRACK_MIME_TYPES, parseVectorImport } from "@logjam/shared";

import { theme } from "../theme";
import { ensureDisplayCached } from "../sync/mediaCache";
import { useMirrorCanyonTracks } from "../sync/useSyncQueries";
import { ROUTE_COLOR } from "../media/RouteMapLayer";

export type CanyonRoutesStatus = { drawn: number; unavailable: number };

export function CanyonRoutesLayer({
  onStatus,
}: {
  /** Drawn/unavailable counts, so the map can say when it is showing less than
   *  everything (DESIGN.md §8: a map that hides things says so). */
  onStatus: (status: CanyonRoutesStatus) => void;
}) {
  const tracks = useMirrorCanyonTracks(TRACK_MIME_TYPES);
  const [collection, setCollection] = useState<GeoJSON.FeatureCollection | null>(
    null,
  );

  useEffect(() => {
    const rows = tracks.data;
    if (!rows) return;
    let cancelled = false;

    (async () => {
      const features: GeoJSON.Feature[] = [];
      let unavailable = 0;
      let drawn = 0;
      for (const row of rows) {
        try {
          const uri = row.localDisplayPath ?? (await ensureDisplayCached(row.id));
          if (uri === null) {
            unavailable += 1;
            continue;
          }
          const text = await FileSystem.readAsStringAsync(uri);
          const parsed = parseVectorImport(row.filename ?? "route.gpx", text);
          for (const feature of parsed.features) {
            features.push({
              ...(feature as GeoJSON.Feature),
              properties: {
                // The canyon's own attachment colour when it has one, so a route
                // matches the strip it came from.
                routeColor: row.color ?? ROUTE_COLOR,
              },
            });
          }
          drawn += 1;
        } catch (err) {
          // A single unreadable file must not empty the whole layer.
          console.error(err);
          unavailable += 1;
        }
        if (cancelled) return;
      }
      if (cancelled) return;
      setCollection({ type: "FeatureCollection", features });
      onStatus({ drawn, unavailable });
    })().catch(console.error);

    return () => {
      cancelled = true;
    };
    // Keyed on the set of route ids: re-parsing on every mirror change would
    // re-read every file for an unrelated canyon edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.data?.map((row) => row.id).join(",")]);

  if (!collection || collection.features.length === 0) return null;

  return (
    <ShapeSource id="canyon-routes" shape={collection as never}>
      {/* Casing first: these lines cross both a pale topo basemap and dark
          imagery, and an uncased line disappears into one of them. */}
      <LineLayer
        id="canyon-routes-casing"
        style={{
          lineColor: theme.primary,
          lineWidth: 5,
          lineOpacity: 0.6,
          lineCap: "round",
          lineJoin: "round",
        }}
      />
      <LineLayer
        id="canyon-routes-line"
        style={{
          lineColor: ["get", "routeColor"] as unknown as string,
          lineWidth: 2.5,
          lineOpacity: 0.95,
          lineCap: "round",
          lineJoin: "round",
        }}
      />
      <CircleLayer
        id="canyon-routes-points"
        filter={["==", ["geometry-type"], "Point"] as never}
        style={{
          circleRadius: 3.5,
          circleColor: ["get", "routeColor"] as unknown as string,
          circleStrokeWidth: 1,
          circleStrokeColor: theme.primary,
        }}
      />
    </ShapeSource>
  );
}

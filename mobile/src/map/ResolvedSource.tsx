// The single place that branches on url-vs-tiles / vector-vs-raster
// (map-sources.md §4.3). Consumers hand it a ResolvedTileSource (status "ok")
// plus the Layer components; layer ids must be suffixed with resolved.key so
// two generations can coexist during a swap.
import type { ReactNode } from "react";
import { RasterSource, VectorSource } from "@maplibre/maplibre-react-native";

import type { ResolvedTileSource } from "./sourceResolver";

export function sourceIdFor(key: string): string {
  return `src-${key}`;
}

export function ResolvedSource({
  resolved,
  children,
}: {
  resolved: Extract<ResolvedTileSource, { status: "ok" }>;
  children: ReactNode;
}) {
  const common = {
    id: sourceIdFor(resolved.key),
    ...(resolved.url != null && { url: resolved.url }),
    ...(resolved.tiles != null && { tileUrlTemplates: resolved.tiles }),
    ...(resolved.minZoom != null && { minZoomLevel: resolved.minZoom }),
    ...(resolved.maxZoom != null && { maxZoomLevel: resolved.maxZoom }),
    ...(resolved.attribution != null && { attribution: resolved.attribution }),
  };
  return resolved.sourceType === "vector" ? (
    <VectorSource key={resolved.key} {...common}>
      {children}
    </VectorSource>
  ) : (
    <RasterSource
      key={resolved.key}
      {...common}
      tileSize={resolved.tileSize ?? 256}
    >
      {children}
    </RasterSource>
  );
}

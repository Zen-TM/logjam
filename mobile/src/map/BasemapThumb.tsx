// A basemap's row leads with a real tile OF that basemap, not a glyph.
//
// Three of the seven sources are renderings of the same NSW ground, and no
// icon vocabulary can say how "SIX Maps Topo" differs from "SIX Maps Base Map"
// — a 44pt square of each answers it instantly. Same idea as the web app's
// basemap gallery, without the live mini-map.
//
// The glyph tile stays as the fallback: the vector basemap has no raster tile
// to show, and offline the fetch fails.
import { useState } from "react";
import { Feather } from "@expo/vector-icons";
import { Image, StyleSheet, View } from "react-native";
import { BASEMAP_CATALOG, lonLatToTile } from "@logjam/shared";

import { assetHue, radius, withAlpha } from "../theme";
import { BASEMAP_META } from "./basemapMeta";
import type { BasemapId } from "./sourceResolver";

// One tile over Katoomba: town, bush, cliffline and a river in the same
// square, so every source has something to look different about. z13 fits all
// of that in one tile and is inside every catalog source's range.
const SAMPLE_LON = 150.312;
const SAMPLE_LAT = -33.714;
const SAMPLE_ZOOM = 13;

/**
 * The sample tile's URL, or null for a source we must not pull a tile from.
 *
 * `offlineCapable` is doing double duty here, and correctly: it is the flag
 * for "the operator has cleared this provider's terms for us to keep its
 * tiles", and a thumbnail is a kept tile. The OSM-family servers explicitly
 * prohibit non-map use of their tiles — asking anyway earns an "Access
 * blocked" image, which is what this screen rendered before the check.
 */
export function sampleTileUrl(basemapId: BasemapId): string | null {
  const entry = BASEMAP_CATALOG.find((candidate) => candidate.id === basemapId);
  if (!entry || entry.kind !== "raster" || !entry.offlineCapable) return null;
  const { x, y } = lonLatToTile(SAMPLE_LON, SAMPLE_LAT, SAMPLE_ZOOM);
  return entry.urlTemplate
    .replace("{z}", String(SAMPLE_ZOOM))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

export function BasemapThumb({ basemapId }: { basemapId: BasemapId }) {
  const [failed, setFailed] = useState(false);
  const url = sampleTileUrl(basemapId);

  if (url === null || failed) {
    return (
      <View style={[styles.tile, styles.glyphTile]}>
        <Feather name={BASEMAP_META[basemapId].icon} size={20} color={assetHue.region} />
      </View>
    );
  }
  return (
    <Image
      style={styles.tile}
      source={{ uri: url }}
      onError={() => setFailed(true)}
      accessibilityIgnoresInvertColors
    />
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    // A hairline keeps a pale imagery tile from bleeding into the card.
    borderWidth: 1,
    borderColor: withAlpha(assetHue.region, 0.35),
    backgroundColor: withAlpha(assetHue.region, 0.16),
  },
  glyphTile: { alignItems: "center", justifyContent: "center" },
});

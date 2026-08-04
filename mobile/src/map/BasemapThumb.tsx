// A basemap's row leads with a real tile OF that basemap, not a glyph.
//
// Three of the seven sources are renderings of the same NSW ground, and no icon
// vocabulary can say how "SIX Maps Topo" differs from "SIX Maps Base Map" — a
// 44pt square of each answers it instantly. Same idea as the web app's basemap
// gallery, without the live mini-map.
//
// The tiles are BUNDLED, not fetched. Fetching them at display time meant the
// list was blank offline (the one place a canyoner is most likely to be opening
// it), cost a request every time the sheet opened, and could not include the
// OSM-family sources at all: their servers answer an unattributed client with an
// "Access blocked" image, which is a worse icon than no icon. One committed
// sample each — regenerate with `scripts/basemap-thumbs.sh` — is 37 KB for the
// set and works with the radio off.
//
// LICENCE: every sample is one tile of a CC-BY-SA (OSM family) or CC-BY (NSW
// SIX) rendering, which permit redistribution with credit. The credit rides in
// the map's attribution sheet, which lists the preview sources alongside the
// active basemap's own attribution. Do not add a source here whose terms don't
// allow keeping a copy of its tiles.
import { Feather } from "@expo/vector-icons";
import { Image, StyleSheet, View } from "react-native";

import { assetHue, radius, withAlpha } from "../theme";
import { BASEMAP_META } from "./basemapMeta";
import type { BasemapId } from "./sourceResolver";

/**
 * One tile over Katoomba (z13, x7516/y4911): town, bush, cliffline and a river
 * in the same square, so every source has something to look different about.
 *
 * `protomaps` is a vector style with no tile to sample; it is drawn on the
 * device from an archive, so its sample is a screenshot of that rendering.
 */
const THUMBS: Partial<Record<BasemapId, number>> = {
  "six-topo": require("../../assets/basemap-thumbs/six-topo.webp"),
  "six-base": require("../../assets/basemap-thumbs/six-base.webp"),
  "six-imagery": require("../../assets/basemap-thumbs/six-imagery.webp"),
  protomaps: require("../../assets/basemap-thumbs/protomaps.webp"),
  "osm-topo": require("../../assets/basemap-thumbs/osm-topo.webp"),
  "osm-cycle": require("../../assets/basemap-thumbs/osm-cycle.webp"),
};

/** Credit for the bundled previews, shown in the attribution sheet. */
export const BASEMAP_THUMB_CREDIT =
  "Preview tiles: © OpenStreetMap contributors, OpenTopoMap and CyclOSM (CC BY-SA); © State of New South Wales (Spatial Services).";

export function BasemapThumb({ basemapId }: { basemapId: BasemapId }) {
  const thumb = THUMBS[basemapId];
  if (thumb === undefined) {
    return (
      <View style={[styles.tile, styles.glyphTile]}>
        <Feather name={BASEMAP_META[basemapId].icon} size={20} color={assetHue.region} />
      </View>
    );
  }
  return <Image style={styles.tile} source={thumb} accessibilityIgnoresInvertColors />;
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

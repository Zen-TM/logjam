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
// sample each — regenerate with `scripts/basemap-thumbs.sh` — is ~220 KB for the
// set and works with the radio off.
//
// RENDERED BY DRAWABLE RESOURCE NAME, not the `require()` id. In release,
// expo-updates' asset resolution routes every `require()` through its
// `localAssets` hash map, and that map is keyed by the embedded manifest's
// `packagerHash` — a lookup that comes back empty here and paints a blank tile
// (the login logo hits the same trap; see LandingScreen's note on assets/logo).
// A bare drawable name like `assets_basemapthumbs_sixtopo` sidesteps the hash
// lookup entirely: RN's Image resolves it straight to the bundled resource,
// exactly the path the logo takes. The `require()`s remain below ONLY to make
// Metro bundle the drawables into the APK.
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

// `void require(...)`: Metro bundles a drawable only when something requires it.
// The returned id is deliberately unused — see the header for why the render
// uses the resource NAME instead of the id.
void require("../../assets/basemap-thumbs/six-topo.png");
void require("../../assets/basemap-thumbs/six-base.png");
void require("../../assets/basemap-thumbs/six-imagery.png");
void require("../../assets/basemap-thumbs/protomaps.png");
void require("../../assets/basemap-thumbs/osm-topo.png");
void require("../../assets/basemap-thumbs/osm-cycle.png");

/**
 * One tile over Katoomba (z13, x7516/y4911): town, bush, cliffline and a river
 * in the same square, so every source has something to look different about.
 *
 * `protomaps` is a vector style with no tile to sample; it is drawn on the
 * device from an archive, so its sample is a screenshot of that rendering.
 *
 * The value is the ANDROID DRAWABLE RESOURCE NAME Metro derives from the file
 * path — `assets/basemap-thumbs/six-topo.png` → `assets_basemapthumbs_sixtopo`
 * (`/`→`_`, `-` dropped, lowercased, no extension). Keep these in lock-step with
 * the `void require(...)` calls above.
 */
const THUMB_RESOURCES: Partial<Record<BasemapId, string>> = {
  "six-topo": "assets_basemapthumbs_sixtopo",
  "six-base": "assets_basemapthumbs_sixbase",
  "six-imagery": "assets_basemapthumbs_siximagery",
  protomaps: "assets_basemapthumbs_protomaps",
  "osm-topo": "assets_basemapthumbs_osmtopo",
  "osm-cycle": "assets_basemapthumbs_osmcycle",
};

/** Credit for the bundled previews, shown in the attribution sheet. */
export const BASEMAP_THUMB_CREDIT =
  "Preview tiles: © OpenStreetMap contributors, OpenTopoMap and CyclOSM (CC BY-SA); © State of New South Wales (Spatial Services).";

export function BasemapThumb({ basemapId }: { basemapId: BasemapId }) {
  const resource = THUMB_RESOURCES[basemapId];
  if (resource === undefined) {
    return (
      <View style={[styles.tile, styles.glyphTile]}>
        <Feather name={BASEMAP_META[basemapId].icon} size={20} color={assetHue.region} />
      </View>
    );
  }
  return (
    <Image
      style={styles.tile}
      source={{ uri: resource }}
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

// Generates the committed Protomaps basemap layer JSONs consumed by
// mobile/src/map/basemap/.
//
// Output is URL-free and MLRN-ready: each layer's `paint` + `layout` are
// merged into a single camelCase `style` object (the format
// @maplibre/maplibre-react-native layer components take), with
// filter/minzoom/maxzoom/source-layer kept as component props. The shell
// style stays empty; the resolver supplies the `protomaps` source URL and
// glyph/sprite URLs at runtime.
//
// Committed, regenerated only deliberately: the output pairs with
// (a) the pinned @protomaps/basemaps version (package.json here) and
// (b) the tileset schema of the S3 extract (daily builds = v4 schema;
// @protomaps/basemaps 5.x targets v4). Refreshing the extract and bumping
// this package happen in the same PR or not at all.
//
// Run: cd scripts/basemap && npm install && npm run generate
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { layers, namedFlavor } from "@protomaps/basemaps";

const require = createRequire(import.meta.url);
const packageVersion = require("@protomaps/basemaps/package.json").version;

const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "mobile",
  "src",
  "map",
  "basemap",
);
const SOURCE_NAME = "protomaps";
const LANG = "en";
// Font stacks available in protomaps/basemaps-assets (fonts/<stack>/…). The
// generated layers must not reference anything outside this set, or labels
// will silently fail to render (glyph 404s).
const AVAILABLE_FONT_STACKS = new Set([
  "Noto Sans Regular",
  "Noto Sans Medium",
  "Noto Sans Italic",
]);

function kebabToCamel(key) {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Merge a MapLibre layer's paint+layout into one camelCase MLRN style object. */
function toMlrnStyle(layer) {
  const style = {};
  for (const group of [layer.paint, layer.layout]) {
    if (!group) continue;
    for (const [key, value] of Object.entries(group)) {
      style[kebabToCamel(key)] = value;
    }
  }
  return style;
}

/** `color` at `opacity` over `under`, both #rrggbb, as an opaque #rrggbb. */
function blend(color, opacity, under) {
  const channels = (hex) =>
    [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const below = channels(under);
  const mixed = channels(color).map((value, i) =>
    Math.round(value * opacity + below[i] * (1 - opacity)),
  );
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** The rail line drawn opaque, in the colour it has over bare land. */
function opaqueRail({ lineOpacity, ...style }, earth) {
  return { ...style, lineColor: blend(style.lineColor, lineOpacity, earth) };
}

function collectFontStacks(layerList) {
  const stacks = new Set();
  // text-font is either a plain string array (the stack itself) or an
  // expression whose font stacks appear as ["literal", [...]] wrappers.
  const visit = (value, isRoot) => {
    if (!Array.isArray(value)) return;
    if (value[0] === "literal" && Array.isArray(value[1])) {
      value[1].forEach((v) => {
        if (typeof v === "string") stacks.add(v);
      });
      return;
    }
    if (isRoot && value.length > 0 && value.every((v) => typeof v === "string")) {
      value.forEach((v) => stacks.add(v));
      return;
    }
    value.forEach((v) => visit(v, false));
  };
  for (const layer of layerList) {
    const textFont = layer.layout?.["text-font"];
    if (textFont) visit(textFont, true);
  }
  return stacks;
}

for (const flavorName of ["light", "dark"]) {
  const layerList = layers(SOURCE_NAME, namedFlavor(flavorName), { lang: LANG });

  const referenced = collectFontStacks(layerList);
  const missing = [...referenced].filter((s) => !AVAILABLE_FONT_STACKS.has(s));
  if (missing.length > 0) {
    throw new Error(
      `Generated ${flavorName} layers reference font stacks not in ` +
        `basemaps-assets: ${missing.join(", ")}`,
    );
  }

  // Logjam GPS mounts one stack per saved area, so a stack's `background`
  // would hide every stack under it; the shell style paints the one background.
  // Guard: mobile/src/map/basemap/protomapsLayers.test.ts.
  const stack = layerList.filter(
    (layer) => layer.type !== "background" && layer.id !== "buildings",
  );
  // Saved areas that share a tile each draw it, and a newer area's land hides
  // only the layers under the water. Above that, a translucent layer paints
  // twice and darkens, with a line where the shared tiles end. Buildings can go
  // under the water, where the Terrain group shades them; rail has to stay over
  // it, so it goes opaque. Guard: mobile/src/map/basemap/protomapsLayers.test.ts.
  stack.splice(
    stack.findIndex((layer) => layer.id === "water"),
    0,
    layerList.find((layer) => layer.id === "buildings"),
  );
  const converted = stack.map((layer) => ({
    id: layer.id,
    type: layer.type,
    ...(layer["source-layer"] && { sourceLayer: layer["source-layer"] }),
    ...(layer.filter !== undefined && { filter: layer.filter }),
    ...(layer.minzoom !== undefined && { minzoom: layer.minzoom }),
    ...(layer.maxzoom !== undefined && { maxzoom: layer.maxzoom }),
    style:
      layer.id === "roads_rail"
        ? opaqueRail(toMlrnStyle(layer), namedFlavor(flavorName).earth)
        : toMlrnStyle(layer),
  }));

  const output = {
    _meta: {
      generator: "scripts/basemap/generate-style.mjs",
      package: `@protomaps/basemaps@${packageVersion}`,
      tilesetSchema: "v4",
      flavor: flavorName,
      lang: LANG,
      fontStacks: [...referenced].sort(),
      generatedAt: new Date().toISOString().slice(0, 10),
    },
    layers: converted,
  };

  const outPath = join(OUT_DIR, `protomapsLayers.${flavorName}.json`);
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
  console.log(
    `wrote ${outPath} (${converted.length} layers, fonts: ${[...referenced].join(", ")})`,
  );
}

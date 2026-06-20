// Canyon name normalization primitives (lowercase/strip + waterway-suffix
// stripping). Consumed by the unified matcher in canyonMatch.ts. The old
// token-Jaccard nameMatchScore was retired once both the RopeWiki dedupe and
// CSV import migrated to that single matcher.

export const WATERWAY_SUFFIXES = [
  "canyon",
  "canyons",
  "gorge",
  "gorges",
  "river",
  "rivers",
  "creek",
  "creeks",
  "gully",
  "gullies",
  "gulch",
  "gulches",
  "ravine",
  "ravines",
  "valley",
  "valleys",
  "brook",
  "brooks",
  "stream",
  "streams",
  "falls",
  "waterfall",
  "waterfalls",
  "tunnel",
  "tunnels",
  "slot",
  "slots",
  "chasm",
  "chasms",
  "watercourse",
  "watercourses",
];

export function norm(s: string): string {
  return s.toLowerCase().replace(/'/g, "").trim();
}

export function stripWaterwaySuffix(name: string): string {
  const n = norm(name);
  for (const suffix of WATERWAY_SUFFIXES) {
    const re = new RegExp(`\\s+${suffix}$`);
    const stripped = n.replace(re, "").trim();
    if (stripped && stripped !== n) return stripped;
  }
  return n;
}


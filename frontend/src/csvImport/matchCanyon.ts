import type { TCanyon } from "../canyonUtils";

const WATERWAY_SUFFIXES = [
  "canyon", "canyons", "gorge", "gorges", "river", "rivers",
  "creek", "creeks", "gully", "gullies", "gulch", "gulches",
  "ravine", "ravines", "valley", "valleys", "brook", "brooks",
  "stream", "streams", "falls", "waterfall", "waterfalls",
  "cave", "caves", "tunnel", "tunnels", "slot", "slots",
  "watercourse", "watercourses",
];

function norm(s: string): string {
  return s.toLowerCase().trim();
}

function stripWaterwaySuffix(name: string): string {
  const n = norm(name);
  for (const suffix of WATERWAY_SUFFIXES) {
    // Match suffix as a whole trailing word
    const re = new RegExp(`\\s+${suffix}$`);
    const stripped = n.replace(re, "").trim();
    if (stripped && stripped !== n) return stripped;
  }
  return n;
}

type MatchResult =
  | { kind: "match"; canyon: TCanyon }
  | { kind: "ambiguous"; canyons: TCanyon[] }
  | { kind: "none" };

export function matchCanyonByName(csvName: string, canyons: TCanyon[]): MatchResult {
  const query = stripWaterwaySuffix(csvName);
  const matches = canyons.filter(
    (c) => norm(c.name).includes(query) || c.altNames.some((a) => norm(a).includes(query)),
  );
  if (matches.length === 1) return { kind: "match", canyon: matches[0] };
  if (matches.length > 1) return { kind: "ambiguous", canyons: matches };
  return { kind: "none" };
}

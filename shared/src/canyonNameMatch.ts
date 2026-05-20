// Canyon name normalization + fuzzy matching. Shared between API (RopeWiki
// dedupe) and frontend (CSV import name matching).

const WATERWAY_SUFFIXES = [
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

function tokens(name: string): string[] {
  return stripWaterwaySuffix(name)
    .split(/[\s\-_/]+/)
    .filter((t) => t.length > 1);
}

export type NameMatchScore = {
  match: boolean;
  tokenJaccard: number;
  sharedTokens: number;
};

// Result is a triage hint, not a definitive judgement. `match` is true when
// the two names should be treated as the same canyon by the dedupe pipeline.
// Caller combines this with distance to reach an auto-link / review / new
// decision.
export function nameMatchScore(a: string, b: string): NameMatchScore {
  const sa = stripWaterwaySuffix(a);
  const sb = stripWaterwaySuffix(b);
  if (!sa || !sb) return { match: false, tokenJaccard: 0, sharedTokens: 0 };
  if (sa === sb) return { match: true, tokenJaccard: 1, sharedTokens: tokens(a).length };
  if (sa.includes(sb) || sb.includes(sa)) {
    const ta = new Set(tokens(a));
    const tb = new Set(tokens(b));
    const shared = [...ta].filter((t) => tb.has(t)).length;
    const union = new Set([...ta, ...tb]).size || 1;
    return { match: true, tokenJaccard: shared / union, sharedTokens: shared };
  }
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  const shared = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size || 1;
  const jaccard = shared / union;
  return { match: jaccard >= 0.6, tokenJaccard: jaccard, sharedTokens: shared };
}

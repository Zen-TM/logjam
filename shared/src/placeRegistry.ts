// The place registry: every named OpenStreetMap feature in NSW, built monthly
// by topo/build_place_registry.py and published at PLACE_REGISTRY_PREFIX on
// the topo CDN. Why it exists and why the file is public: ADR 0034.
//
// searchPlaces is the one ranking. The API answers Logjam Web and a phone
// without the file with it, and Logjam GPS runs it on its own copy, so a
// query ranks the same online and offline. Guard: placeRegistry.test.ts.
//
// PRIVACY: the typed query is the sensitive part, often the name of a place
// the user would rather not publish.

/** Bumped when the file's shape changes. Each format has its own prefix, so
 *  an older client keeps reading builds in the format it knows. */
export const PLACE_REGISTRY_FORMAT = 1;

/** Path under the topo CDN base URL (TOPO_CDN_BASE_URL). */
export const PLACE_REGISTRY_PREFIX = `master/places/v${PLACE_REGISTRY_FORMAT}/`;

/** The pointer to the current build: small, short-cached, read first. */
export const PLACE_REGISTRY_POINTER_PATH = `${PLACE_REGISTRY_PREFIX}latest.json`;

/** Shown wherever registry results are, as the ODbL asks. */
export const PLACE_REGISTRY_ATTRIBUTION = "© OpenStreetMap contributors";

/** Shorter than this, a query matches too much to rank usefully. */
export const PLACE_SEARCH_MIN_QUERY_LENGTH = 2;

export interface PlaceRegistryPointer {
  format: number;
  /** The extract's date, `YYYY-MM-DD`. */
  version: string;
  /** The data file's name, relative to PLACE_REGISTRY_PREFIX. */
  path: string;
  /** The gzipped data file's size, for a download estimate. */
  bytes: number;
}

/** The data file, once gunzipped and parsed. One column per field, one
 *  entry per row, all the same length. */
export interface PlaceRegistryFile {
  format: number;
  version: string;
  attribution: string;
  licence: string;
  /** `lon` and `lat` are integers in units of 1/coordScale degrees. */
  coordScale: number;
  /** OSM `key=value`, such as `natural=peak`. */
  kinds: string[];
  names: string[];
  /** An index into `kinds`. */
  kind: number[];
  lon: number[];
  lat: number[];
  /** The nearest settlement's row, or -1. */
  near: number[];
  /** [row, its alternate names], for the rows that have any. */
  alternates: [number, string[]][];
}

export interface PlaceResult {
  name: string;
  /** What it is, for reading: "Peak", "Waterfall", "Road". */
  kind: string;
  /** The nearest town or locality, telling two of a name apart. */
  near: string | null;
  lon: number;
  lat: number;
}

/** A result's second line, the same on both clients: "Peak near Katoomba".
 *  A town is not near itself. */
export function placeResultDetail(result: PlaceResult): string {
  return result.near && result.near !== result.name
    ? `${result.kind} near ${result.near}`
    : result.kind;
}

/** `POST` with a PlaceSearchRequest body, so the query travels in the body
 *  and not the URL that access logs keep. */
export const PLACE_SEARCH_API_PATH = "/places/search";

/** How long a client waits after the last keystroke before asking the API.
 *  The API's per-user limit is sized for it. Guard:
 *  `api/src/middleware/rateLimit.unit.test.ts` ("placeSearchLimiter"). */
export const PLACE_SEARCH_DEBOUNCE_MS = 200;

/** Most results a search returns, and the API's default. */
export const PLACE_SEARCH_MAX_RESULTS = 20;

export interface PlaceSearchRequest {
  q: string;
  limit?: number;
}

export interface PlaceSearchResponse {
  results: PlaceResult[];
  /** The registry version that answered, as in its pointer. */
  version: string;
}

export function isPlaceRegistryPointer(
  value: unknown,
): value is PlaceRegistryPointer {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.format === PLACE_REGISTRY_FORMAT &&
    typeof v.version === "string" &&
    typeof v.path === "string" &&
    // The path is joined onto our CDN URL, so it may only name a file there.
    // Guard: placeRegistry.test.ts.
    /^[\w-][\w.-]*$/.test(v.path) &&
    typeof v.bytes === "number"
  );
}

/** The data file's URL for a pointer, under the topo CDN base URL. */
export function placeRegistryUrl(
  baseUrl: string,
  pointer: PlaceRegistryPointer,
): string {
  return `${baseUrl}/${PLACE_REGISTRY_PREFIX}${pointer.path}`;
}

// Words for the kinds whose OSM value reads wrong to a walker ("residential"
// for a street). Every other kind reads as its value: camp_site → "Camp site".
const KIND_LABELS: Record<string, string> = {
  "boundary=protected_area": "Reserve",
  "boundary=national_park": "National park",
  "leisure=nature_reserve": "Nature reserve",
  "waterway=stream": "Creek",
  "waterway=river": "River",
  "waterway=waterfall": "Waterfall",
  "highway=motorway": "Road",
  "highway=trunk": "Road",
  "highway=primary": "Road",
  "highway=secondary": "Road",
  "highway=tertiary": "Road",
  "highway=unclassified": "Road",
  "highway=residential": "Street",
  "highway=living_street": "Street",
  "highway=service": "Road",
  "highway=track": "Track",
  "highway=path": "Path",
  "highway=footway": "Path",
  "highway=trailhead": "Trailhead",
  "tourism=viewpoint": "Lookout",
  "place=isolated_dwelling": "Homestead",
};

// `key=yes` says only which key it is: `natural=yes` is a natural feature.
const YES_LABELS: Record<string, string> = {
  natural: "Natural feature",
  tourism: "Attraction",
  historic: "Historic site",
  man_made: "Structure",
  landuse: "Area",
  leisure: "Leisure area",
};

function capitalised(text: string): string {
  const spaced = text.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function placeKindLabel(kind: string): string {
  const label = KIND_LABELS[kind];
  if (label) return label;
  const [key, value] = kind.split("=");
  if (value === "yes") return YES_LABELS[key] ?? capitalised(key);
  return capitalised(value);
}

// Among equally good name matches, what someone navigating the bush means
// first, lowest first. A kind not listed here ranks last; `place` is listed
// value by value, so a farm ranks last too. Guard: placeRegistry.test.ts.
const KIND_RANKS: Record<string, number> = {
  "place=city": 0,
  "place=town": 0,
  "place=village": 1,
  "place=suburb": 1,
  natural: 1,
  waterway: 1,
  water: 1,
  "boundary=national_park": 1,
  "boundary=protected_area": 1,
  "leisure=nature_reserve": 1,
  "place=hamlet": 2,
  "place=locality": 2,
  tourism: 2,
  historic: 2,
  leisure: 2,
  "highway=trailhead": 2,
  highway: 3,
};
const OTHER_KIND_RANK = 4;

export function placeKindRank(kind: string): number {
  return KIND_RANKS[kind] ?? KIND_RANKS[kind.split("=")[0]] ?? OTHER_KIND_RANK;
}

// Outside printable ASCII; control characters take the general path too.
const NON_ASCII = /[^ -~]/;

/** Lowercase, accents and apostrophes dropped, punctuation as spaces. */
export function normalizeSearchText(text: string): string {
  // Nearly every name is plain ASCII, and indexing normalizes 320,000 of
  // them: on Android, Hermes hands each normalize() to the platform, which
  // made building the index take seconds. ASCII has no accents to drop.
  if (!NON_ASCII.test(text)) {
    return text
      .toLowerCase()
      .replace(/['`]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The registry, prepared for repeated searching. Build it once per file,
 *  then drop the parsed file: the packed columns here are a fraction of it. */
export interface PlaceIndex {
  names: string[];
  kinds: string[];
  kind: Uint16Array;
  /** The nearest settlement's row, or -1. */
  near: Int32Array;
  lon: Float64Array;
  lat: Float64Array;
  rank: Uint8Array;
  /** Normalized names. */
  hay: Haystack;
  /** Normalized alternate names, and the row each belongs to. */
  altHay: Haystack;
  altRow: Int32Array;
}

// Normalized strings joined by "\n", which normalizing never leaves in one,
// and where each starts (one more entry than strings, for the end). One
// native indexOf over the whole registry finds the few rows holding the
// query's first word; a loop over 320,000 strings cost ten times as long,
// which a phone feels on every keystroke.
type Haystack = { text: string; starts: Int32Array };

function haystack(strings: string[]): Haystack {
  const starts = new Int32Array(strings.length + 1);
  let at = 0;
  strings.forEach((s, i) => {
    starts[i] = at;
    at += s.length + 1;
  });
  starts[strings.length] = at;
  return { text: strings.join("\n"), starts };
}

function entry(hay: Haystack, at: number): string {
  return hay.text.slice(hay.starts[at], hay.starts[at + 1] - 1);
}

/** Each entry of `hay` holding `word`, once, in order. */
function* entriesWith(hay: Haystack, word: string): Generator<number> {
  let from = 0;
  for (;;) {
    const found = hay.text.indexOf(word, from);
    if (found < 0) return;
    // The last entry starting at or before `found`.
    let lo = 0;
    let hi = hay.starts.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (hay.starts[mid] <= found) lo = mid;
      else hi = mid - 1;
    }
    yield lo;
    from = hay.starts[lo + 1];
  }
}

export function indexPlaceRegistry(file: PlaceRegistryFile): PlaceIndex {
  const build = buildPlaceIndex(file, Infinity);
  let step = build.next();
  while (!step.done) step = build.next();
  return step.value;
}

/**
 * The same index, built a slice of rows at a time with `pause()` awaited
 * between slices, so building it never holds a phone's JS thread for long.
 * Building normalizes every name: 0.9 s in one go on a Pixel.
 */
export async function indexPlaceRegistryInSlices(
  file: PlaceRegistryFile,
  pause: () => Promise<void>,
  sliceRows = 20_000,
): Promise<PlaceIndex> {
  const build = buildPlaceIndex(file, sliceRows);
  let step = build.next();
  while (!step.done) {
    await pause();
    step = build.next();
  }
  return step.value;
}

function* buildPlaceIndex(
  file: PlaceRegistryFile,
  sliceRows: number,
): Generator<void, PlaceIndex> {
  if (file.format !== PLACE_REGISTRY_FORMAT) {
    throw new Error(`Unknown place registry format ${String(file.format)}`);
  }
  const normalized = new Array<string>(file.names.length);
  for (let at = 0; at < file.names.length; at++) {
    normalized[at] = normalizeSearchText(file.names[at]);
    if ((at + 1) % sliceRows === 0) yield;
  }
  const kindRanks = file.kinds.map(placeKindRank);
  const alts: string[] = [];
  const altRows: number[] = [];
  for (const [row, names] of file.alternates) {
    for (const alt of names) {
      alts.push(normalizeSearchText(alt));
      altRows.push(row);
    }
  }
  const unscale = (values: number[]) =>
    Float64Array.from(values, (v) => v / file.coordScale);
  return {
    names: file.names,
    kinds: file.kinds,
    kind: Uint16Array.from(file.kind),
    near: Int32Array.from(file.near),
    lon: unscale(file.lon),
    lat: unscale(file.lat),
    rank: Uint8Array.from(file.kind, (k) => kindRanks[k]),
    hay: haystack(normalized),
    altHay: haystack(alts),
    altRow: Int32Array.from(altRows),
  };
}

// How well one normalized name answers the query, best 0; -1 for no match.
// `spaced` is each word with a leading space, built once per search.
function nameTier(
  name: string,
  query: string,
  words: string[],
  spaced: string[],
): number {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  // Every typed word starts a word of the name, in any order: "gorge wol"
  // finds "Wolgan Gorge".
  if (words.every((w, i) => name.startsWith(w) || name.includes(spaced[i]))) {
    return 2;
  }
  if (name.includes(query)) return 3;
  return -1;
}

type Hit = { row: number; tier: number };

/**
 * Registry rows matching `query`, best first.
 *
 * Best is, in order: the whole name, a name starting with the query, a name
 * with every typed word starting one of its words, a name containing the
 * query, then the same four against alternate names. Ties go to the kind a
 * walker means first (KIND_RANKS), then the shorter name.
 */
export function searchPlaces(
  index: PlaceIndex,
  query: string,
  limit: number,
): PlaceResult[] {
  const needle = normalizeSearchText(query);
  // A NaN or huge limit would make the top-k below unbounded.
  const most = Math.min(Math.floor(limit), PLACE_SEARCH_MAX_RESULTS);
  if (needle.length < PLACE_SEARCH_MIN_QUERY_LENGTH || !(most >= 1)) return [];
  const words = needle.split(" ");
  const spaced = words.map((w) => ` ${w}`);
  const { hay, altHay, altRow, rank } = index;
  // An entry's length, from where it and the next start.
  const length = (row: number) => hay.starts[row + 1] - hay.starts[row];

  const better = (a: Hit, b: Hit) =>
    a.tier - b.tier ||
    rank[a.row] - rank[b.row] ||
    length(a.row) - length(b.row) ||
    a.row - b.row;

  // The best `most` so far, kept sorted: a two-letter query matches tens of
  // thousands of rows, and sorting them all is most of the search's time.
  const best: Hit[] = [];
  const offer = (hit: Hit) => {
    if (best.length === most && better(hit, best[most - 1]) >= 0) return;
    let at = best.length;
    while (at > 0 && better(hit, best[at - 1]) < 0) at--;
    best.splice(at, 0, hit);
    if (best.length > most) best.pop();
  };

  // Every tier needs the first word somewhere in the name.
  const byName = new Set<number>();
  for (const row of entriesWith(hay, words[0])) {
    const tier = nameTier(entry(hay, row), needle, words, spaced);
    if (tier < 0) continue;
    byName.add(row);
    offer({ row, tier });
  }
  // An alternate counts only for a row its own name did not match, and once.
  const byAlternate = new Map<number, number>();
  for (const at of entriesWith(altHay, words[0])) {
    const row = altRow[at];
    if (byName.has(row)) continue;
    const tier = nameTier(entry(altHay, at), needle, words, spaced);
    if (tier < 0) continue;
    const seen = byAlternate.get(row);
    if (seen === undefined || tier < seen) byAlternate.set(row, tier);
  }
  for (const [row, tier] of byAlternate) offer({ row, tier: 4 + tier });
  return best.map(({ row }) => placeResult(index, row));
}

function placeResult(index: PlaceIndex, row: number): PlaceResult {
  const near = index.near[row];
  return {
    name: index.names[row],
    kind: placeKindLabel(index.kinds[index.kind[row]]),
    near: near >= 0 ? index.names[near] : null,
    lon: index.lon[row],
    lat: index.lat[row],
  };
}

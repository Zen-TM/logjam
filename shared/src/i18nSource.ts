// What the i18n guards read from source: every message (`t`, `plural`, `rich`,
// `say`) with its key, and every bare literal a user may read that skipped them.
// The guards are `i18nCoverage.test.ts` in each package; the reasoning is
// docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md.
import type * as TypeScript from "typescript";
import {
  COPY_CALLS,
  COPY_PROPS,
  MESSAGE_TAGS,
  pluralNames,
} from "./copyRules.js";
import { type Catalogue, RICH_TAG, templateKey } from "./i18n.js";

/** Where the reasoning for the guards that read this scan lives. */
export const I18N_ADR =
  "docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md";

export type MessageKind = "t" | "say" | "rich" | "plural";

export type SourceMessage = {
  line: number;
  kind: MessageKind;
  /** The catalogue key: the English with each hole written `{0}`, `{1}`, … (a plural's is its `other` form). */
  key: string;
  /** What is wrong with it, from `messageProblems`; empty when it is fine. */
  problems: string[];
};

const loadFile = (
  ts: typeof TypeScript,
  fileName: string,
  source: string,
): TypeScript.SourceFile =>
  ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

/** The literal parts of a template: one for a plain one, else head, then each span's. */
function templateParts(
  ts: typeof TypeScript,
  template: TypeScript.TemplateLiteral,
): string[] {
  return ts.isNoSubstitutionTemplateLiteral(template)
    ? [template.text]
    : [
        template.head.text,
        ...template.templateSpans.map((s) => s.literal.text),
      ];
}

/** What a message's key must not be, or hold. `parts` are the literal parts of a template, which hold no `{0}` of their own (a plural's strings do, so it passes none), and `key` the catalogue key. */
export function messageProblems(
  kind: MessageKind,
  key: string,
  parts: readonly string[],
): string[] {
  const problems: string[] = [];
  if (key !== key.trim())
    problems.push(
      "starts or ends with a space: a sentence glued from fragments can't be translated",
    );
  if (parts.some((part) => /\{\d+\}/.test(part)))
    problems.push("holds a literal {0}, which the catalogue reads as a hole");
  if (kind === "plural" && !key.includes("#"))
    problems.push("a plural's other form holds no # for the count");
  if (kind === "rich" && key.replace(RICH_TAG, "").match(/[<>]/))
    problems.push(
      "holds a tag rich can't consume (nested, unclosed, or a stray < or >)",
    );
  return problems;
}

/**
 * Every message in a source file, with its key. A `plural` whose two forms
 * are not literals has no key to look up, so it is reported with the problem
 * rather than skipped.
 */
export function messagesIn(
  tsModule: unknown,
  fileName: string,
  source: string,
): SourceMessage[] {
  const ts = tsModule as typeof TypeScript;
  const sf = loadFile(ts, fileName, source);
  const found: SourceMessage[] = [];
  const plurals = pluralNames(ts, sf);
  const lineOf = (node: TypeScript.Node) =>
    sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const visit = (node: TypeScript.Node): void => {
    if (
      ts.isTaggedTemplateExpression(node) &&
      MESSAGE_TAGS.has(node.tag.getText())
    ) {
      const parts = templateParts(ts, node.template);
      const key = templateKey(parts);
      const kind = node.tag.getText() as MessageKind;
      found.push({
        line: lineOf(node),
        kind,
        key,
        problems: messageProblems(kind, key, parts),
      });
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      plurals.has(node.expression.text)
    ) {
      const [, one, other] = node.arguments;
      const literal = (arg?: TypeScript.Expression) =>
        arg && ts.isStringLiteralLike(arg) ? arg.text : undefined;
      const key = literal(other);
      found.push(
        key === undefined || literal(one) === undefined
          ? {
              line: lineOf(node),
              kind: "plural",
              key: other?.getText() ?? "",
              problems: ["its two forms are not string literals"],
            }
          : {
              line: lineOf(node),
              kind: "plural",
              key,
              problems: messageProblems("plural", key, []),
            },
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** JSX attributes whose string is never words: styling, wiring, a link, an id. */
const NOT_COPY_ATTRS =
  /^(?:className|class|style|id|key|ref|testID|nativeID|role|type|name|href|src|to|target|rel|htmlFor|for|value|defaultValue|autoComplete|inputMode|pointerEvents|resizeMode|source|d|viewBox|fill|stroke|transform|data-.*|aria-(?!label).*)$/;

/** Calls whose string arguments are code, a log line or a developer's message, never words a user reads (`console.*` is `CONSOLE`). */
const NOT_COPY_CALLS =
  /^(?:logger\.\w+|log\.\w+|require|malformed|fault|\w+\.\$(?:query|execute)Raw\w*|Prisma\.sql|matchMedia|\w+\.(?:querySelector\w*|getElementById|setItem|getItem|removeItem|addEventListener|removeEventListener|getAttribute|setAttribute|setHeader|header|set|append))$/;

/** An all-capitals SQL keyword: a string holding one is a query, and so is every part of a template that does. */
const SQL =
  /\b(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM|RETURNING|PRAGMA|CREATE TABLE|CREATE INDEX|ORDER BY|GROUP BY|LIMIT|FOR UPDATE|FOR SHARE|IS NULL|IS NOT NULL|PRIMARY KEY|NOT NULL|DROP TABLE|ALTER TABLE|ADD COLUMN)\b/;

/** Tagged templates that are code: SQL, CSS, shaders. */
const NOT_COPY_TAGS = /^(?:sql|Prisma\.sql|css|glsl|html)$/;

/** `new X(…)` whose argument is a developer's message. */
const NOT_COPY_NEW = /^(?:\w*Error|RegExp|URL|URLSearchParams|Set|Map)$/;

/** A `console` call: everything inside it is a developer's log line. */
const CONSOLE = /^console\.\w+$/;

/** A word: two or more letters, or letters round an inner apostrophe ("You're"). */
const WORD = String.raw`(?:\p{L}{2,}|\p{L}+['\u2019]\p{L}+)`;

/** The one-letter words English writes on their own: "Find a route", "Can I help". Any other lone letter is a symbol or an id, so `x or y` is not prose; the `a` of a tag (`<a href>`, `</a>`) is not a word either. */
const ONE_LETTER_WORD = String.raw`(?<![\p{L}'\u2019</])[aAI](?![\p{L}'\u2019])`;

/** Two words with a space between (one of them may be "a" or "I"), or a one-word sentence: what reads as prose. */
const PROSE = new RegExp(
  String.raw`${WORD}\W*\s\W*(?:${WORD}|${ONE_LETTER_WORD})|${ONE_LETTER_WORD}\W*\s\W*${WORD}|^\p{Lu}\p{Ll}+[.!?\u2026]$`,
  "u",
);

/** How many words a string has, counting "a" and "I": what `addJoined` asks two of. */
const WORDS_IN = new RegExp(`${WORD}|${ONE_LETTER_WORD}`, "gu");

/** A colour such as `#F7F3EC`: it has letters but no words. */
const HEX = /^#[0-9a-f]{3,8}$/i;

/**
 * Code that reads as words: a bracket or underscore (a selector, a path), a
 * media query `(hover: none)`, a CSS value, a selector list `input, textarea`,
 * an HTTP header value.
 */
const CODE =
  /[[\]{}_]|^\([^()]*:[^()]*\)$|var\(--|color-mix\(|^[a-z0-9]+(?:, ?[a-z0-9]+)+$|^(?:attachment|inline);|; charset=|\dpx|xxpx/;

/** A literal that is only markup: a tag, an XML declaration, a GPX element, with no word outside the tags (a hole's stand-in is not one). A tag with words between its tags is copy. */
const isMarkup = (text: string): boolean =>
  /<[?!/]?[A-Za-z][^>]*>/.test(text) &&
  !new RegExp(WORD, "u").test(text.replace(/<[^>]*>/g, " "));

/** A map style property ("text-font", "icon-image"): its value is a font, an expression or an id. Another hyphenated key ("six-base") names a thing, and its value may be words. */
const MAP_STYLE_KEY =
  /^(?:text|icon|line|circle|symbol|fill|raster|background|heatmap|hillshade|source)-/;

/** The catalogue folder: its keys and values are text by design, read by `messagesIn`'s consumers, never counted as bare. */
const CATALOGUE_FILE = /(?:^|\/)i18nCatalogues\//;

/** Files whose every flagged string is not words a user reads, with why. Paths from the repo root. */
export const EXEMPT_FILES: Readonly<Record<string, string>> = {
  "shared/src/ozUltimate.ts": "canyon names, which are proper nouns",
  "shared/src/copyRules.ts":
    "what a failing copy test tells the developer to write instead",
  "shared/src/i18nSource.ts": "what a failing i18n test tells the developer",
  "shared/src/i18nCodemod.ts": "what the codemod tells the developer it left",
  "shared/src/areaExport.ts":
    "what the API logs about a request only a broken client can send (`malformed`)",
  "shared/src/geoPdfConfig.ts":
    "what a render request is refused for, read by the developer of a broken client",
  "shared/src/announcementMarkdown.ts":
    "the Markdown an announcement lost, listed for the maintainer who wrote it",
  "shared/src/topoRegions.ts": "the header of a generated file",
  "shared/src/routeValidation.ts":
    "what the API logs about a route it refuses (`malformed`), which no client shows",
  "shared/src/elevation.ts":
    "what the API logs about an elevation point it refuses (`malformed`), which no client shows",
  "shared/src/kit.ts":
    "notes on each kit component, read by the people who build it",
  "shared/src/webTokens.ts": "the CSS generated from the design tokens",
  "api/src/lib/dataExport.ts":
    "notes on why a model is left out of what a user downloads, read by developers",
  "api/src/lib/placeVisibility.ts":
    "notes on why a field is withheld from a sharee, read by developers",
};

const FORMATION =
  "a vegetation formation as the map data and the build script name it";
/** A source's credit as its publisher wrote it, plain and HTML alike. */
const CREDIT =
  "a source's credit, in its publisher's wording, plain and HTML alike";
const STORED =
  "a built-in's name or hint, which the seed and the migration write to rows";
const CODE_ERROR = "an import failure code, matched with ===";
const LAMBDA = "matched against the pre-signup Lambda's English message";
const DETAIL =
  "developer detail: the API logs it (`malformed`), no client shows it";
const SQL_TEXT = "SQL text the query is built from";
const SELECTOR = "a CSS selector a script looks an element up by";
const FONT =
  "a font's name, which the map or the PDF looks up by that spelling";
const PRODUCT = "the product's name, which is not translated";
const STORAGE_ERROR =
  "a message of the storage PUT, matched with includes to tell a dropped link, never shown";
const CSV_HEADER =
  "an English column header matched against the user's own file, not shown";
const IMPORT_NOTE =
  "a RopeWiki import's note on a row it skipped, returned in `errors`, which Logjam Web counts and never shows";
const STOP_REASON =
  "the reason an ECS task is stopped with, read in the AWS console";
const SENDER = "the User-Agent the API sends RopeWiki, which reads it";
const ROPEWIKI_COLUMN =
  "a column header of RopeWiki's published CSV, matched against its own spelling";
const WIPE_NOTE =
  "why a store survives a sign-out, kept for developers: no screen shows it, one test reads its length";
const DEV_NOTE = "a note on a field, read by developers";
const CLI_REFUSAL =
  "what the announce script refuses a file for, logged for the maintainer who runs it";
const ENV_MESSAGE =
  "what a malformed environment value fails start-up with, read by the operator";

/**
 * Text that reads as words and is not words a user reads, per file that holds
 * it: an operator the place filter stores, a land tenure class as the map data
 * spells it, RopeWiki's name for a region, the producer a PDF names, a noun in
 * a developer's error or detail, a vegetation formation, a source's credit, a
 * built-in's stored name, an import failure code. A literal equal to an entry
 * in its own file is never counted or converted; the same words in another
 * file are. `i18nCoverage.test.ts` ("lists only literals that exist, in the file that holds them") fails on
 * an entry its file does not hold.
 */
export const DATA_LITERALS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  "shared/src/apiErrors.ts": {
    "Logjam is not taking new accounts this month": LAMBDA,
  },
  "shared/src/demSources.ts": {
    "Terrain data: Terrain Tiles (Mapzen / Tilezen), via AWS Open Data.":
      CREDIT,
    'Terrain data: <a href="https://registry.opendata.aws/terrain-tiles">Terrain Tiles</a> (Mapzen / Tilezen).':
      CREDIT,
  },
  "shared/src/geoPdfBaseLayers.ts": {
    "© Department of Customer Service": CREDIT,
    "Base map © State of New South Wales (Spatial Services, a business unit of the Department of Customer Service NSW). For current information go to spatial.nsw.gov.au.":
      CREDIT,
    '&copy; State of New South Wales (Spatial Services, a business unit of the Department of Customer Service NSW). For current information go to <a href="https://spatial.nsw.gov.au">spatial.nsw.gov.au</a>.':
      CREDIT,
    "Base map © OpenStreetMap contributors (Protomaps build)": CREDIT,
    "Base map © OpenStreetMap contributors": CREDIT,
    "Base map © OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors, SRTM":
      CREDIT,
    "Base map © CyclOSM, © OpenStreetMap contributors": CREDIT,
    "Imagery © State of New South Wales (Spatial Services, a business unit of the Department of Customer Service NSW). For current information go to spatial.nsw.gov.au.":
      CREDIT,
    "Elevation derived from LiDAR via ELVIS (elevation.fsdf.org.au) © State of NSW (Spatial Services) / Commonwealth of Australia (Geoscience Australia), CC BY 4.0. See dataset metadata for the specific custodian.":
      CREDIT,
    "Vegetation © State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2020 — State Vegetation Type Map (CC BY 4.0). …":
      CREDIT,
    "Features © OpenStreetMap contributors": CREDIT,
  },
  "shared/src/geoPdfImport/parseGeoref.ts": {
    "Logjam GeoPDF Generator":
      "the producer Logjam writes into a PDF and recognises on import",
  },
  "shared/src/licences.ts": {
    "gauge feed": "a noun in the error a region's declaration throws",
    "place registry": "a noun in the error a region's declaration throws",
  },
  "shared/src/placeFilterOptions.ts": {
    "Less than": "a stored operator of a number filter",
    "More than": "a stored operator of a number filter",
  },
  "shared/src/placeRegistry.ts": {
    "© OpenStreetMap contributors": CREDIT,
  },
  "shared/src/placeTypes.ts": {
    "V grade": STORED,
    "Vertical technical difficulty, on the French rating system.": STORED,
    "A grade": STORED,
    "Aquatic difficulty of the water sections, on the French rating system.":
      STORED,
    Commitment: STORED,
    "How hard the canyon is to escape or retreat from once committed, on the French rating system.":
      STORED,
    Quality: STORED,
    "Your own verdict. 1 is unremarkable, 5 is exceptional.": STORED,
    Hours: STORED,
    "How long it takes an average group, car to car.": STORED,
    Pitches: STORED,
    "How many abseils.": STORED,
    "Longest pitch": STORED,
    "The longest single abseil, measured along the rope.": STORED,
    Capacity: STORED,
    "Is a cave?": STORED,
    "Has a water source?": STORED,
    "ACA technical": STORED,
    "Technical difficulty of the descent, on the American Canyoneering Association rating system.":
      STORED,
    "ACA water": STORED,
    "Difficulty of the water, from little or no water (A) to the most powerful (C4), on the American Canyoneering Association rating system.":
      STORED,
    "ACA time": STORED,
    "How long the canyon takes, in Roman numerals, on the American Canyoneering Association rating system.":
      STORED,
    "ACA risk": STORED,
    "How dangerous the canyon is beyond its technical difficulty, on the American Canyoneering Association rating system.":
      STORED,
  },
  "shared/src/regions.ts": {
    OzUltimate: "a source's name, which the API stores in a place's sources",
    "Elevation: derived from the NSW 5 m Digital Elevation Model, © State of New South Wales (Spatial Services), extracted October 2026. CC BY 3.0 AU.":
      CREDIT,
    'Elevation: derived from the NSW 5 m Digital Elevation Model, © State of New South Wales (<a href="https://www.spatial.nsw.gov.au">Spatial Services</a>), extracted October 2026. <a href="https://creativecommons.org/licenses/by/3.0/au/">CC BY 3.0 AU</a>.':
      CREDIT,
    "National Park": "a tenure class as the land map data spells it",
    "State Forest": "a tenure class as the land map data spells it",
    "Indigenous Owned": "a tenure class as the land map data spells it",
    "Unresolved Tenure": "a tenure class as the land map data spells it",
    "Land: NSW Land Tenure, December 2024 v2 © State of New South Wales (Department of Primary Industries and Regional Development), CC BY 4.0":
      CREDIT,
    'Land: <a href="https://data.nsw.gov.au/data/dataset/nsw-land-tenure">NSW Land Tenure</a>, December 2024 v2 &copy; State of New South Wales (Department of Primary Industries and Regional Development), <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>':
      CREDIT,
    "Fire history © State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2010 — NPWS Fire History - Wildfires and Prescribed Burns (CC BY 4.0)":
      CREDIT,
    'Fire history &copy; State Government of NSW and NSW Department of Climate Change, Energy, the Environment and Water 2010 — <a href="https://datasets.seed.nsw.gov.au/dataset/fire-history-wildfires-and-prescribed-burns-1e8b6">NPWS Fire History - Wildfires and Prescribed Burns</a> (<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>)':
      CREDIT,
    "Mobile coverage: ACCC Mobile Infrastructure Report data release © Commonwealth of Australia (ACCC), CC BY 2.5 AU; coastline © ABS, CC BY 4.0":
      CREDIT,
    'Mobile coverage: <a href="https://data.gov.au/data/dataset/accc-mobile-infrastructure-report-data-release">ACCC Mobile Infrastructure Report data release</a> &copy; Commonwealth of Australia (ACCC), <a href="https://creativecommons.org/licenses/by/2.5/au/">CC BY 2.5 AU</a>; coastline &copy; <a href="https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3">ABS</a>, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>':
      CREDIT,
    "New South Wales": "RopeWiki's name for the region",
  },
  "shared/src/topoSettings.ts": {
    "Not classified": FORMATION,
    "Wet Sclerophyll Forests (Grassy sub-formation)": FORMATION,
    "Wet Sclerophyll Forests (Shrubby sub-formation)": FORMATION,
    "Dry Sclerophyll Forests (Shrub/grass sub-formation)": FORMATION,
    "Dry Sclerophyll Forests (Shrubby sub-formation)": FORMATION,
    "Grassy Woodlands": FORMATION,
    "Forested Wetlands": FORMATION,
    "Freshwater Wetlands": FORMATION,
    "Saline Wetlands": FORMATION,
    "Semi-arid Woodlands (Grassy sub-formation)": FORMATION,
    "Semi-arid Woodlands (Shrubby sub-formation)": FORMATION,
    "Arid Shrublands (Acacia sub-formation)": FORMATION,
    "Arid Shrublands (Chenopod sub-formation)": FORMATION,
    "Alpine Complex": FORMATION,
    "root must be an object": DETAIL,
    "labelScale must be …..…": DETAIL,
    "hillshade must be an object": DETAIL,
    "hillshade.enabled must be boolean": DETAIL,
    "hillshade.colour must be #RRGGBBAA": DETAIL,
    "hillshade.azimuth must be 0..360": DETAIL,
    "hillshade.altitude must be 0..90": DETAIL,
    "hillshade.zFactor must be 0.1..10": DETAIL,
    "hillshade.multidirectional must be boolean": DETAIL,
    "slope must be an object": DETAIL,
    "slope.enabled must be boolean": DETAIL,
    "slope.bands must be array": DETAIL,
    "slope.bands max length is …": DETAIL,
    "vegetation must be an object": DETAIL,
    "vegetation.enabled must be boolean": DETAIL,
    "vegetation.minRatio must be 0..1": DETAIL,
    "vegetation.maxRatio must be 0..1": DETAIL,
    "vegetation.minRatio must be < maxRatio": DETAIL,
    "vegetation.sparseColour must be #RRGGBBAA": DETAIL,
    "vegetation.denseColour must be #RRGGBBAA": DETAIL,
    "vegetation.alphaMin must be 0..255": DETAIL,
    "vegetation.alphaMax must be 0..255": DETAIL,
    "vegetation.weightsEnabled must be boolean": DETAIL,
    "vegetation.formationWeights must be an object": DETAIL,
    "contours must be an object": DETAIL,
    "contours.enabled must be boolean": DETAIL,
    "contours.zoomBands must be array of length 3": DETAIL,
    "features must be an object": DETAIL,
    "features.enabled must be boolean": DETAIL,
    "contours.majorColour must be #RRGGBBAA": DETAIL,
    "contours.minorColour must be #RRGGBBAA": DETAIL,
    "contours.majorWidthM must be 0..200": DETAIL,
    "contours.minorWidthM must be 0..200": DETAIL,
    "features.… must be an object": DETAIL,
    "features.….enabled must be boolean": DETAIL,
    "features.….colour must be #RRGGBBAA": DETAIL,
    "features.….widthZ18 must be 0..100": DETAIL,
  },
  "shared/src/tripPlans.ts": {
    "a field value": DETAIL,
  },
  "shared/src/vectorImport.ts": {
    "File could not be parsed": CODE_ERROR,
    "File contains invalid coordinates": CODE_ERROR,
    "No mappable features found in the file": CODE_ERROR,
    "File has too many points to import": CODE_ERROR,
    "File is too large to import": CODE_ERROR,
    "Unsupported file type — use GPX, KML, or GeoJSON": CODE_ERROR,
  },
  "frontend/src/components/dialogs/PlaceDialog.tsx": {
    "https://": "the start of the address a user types after it, not words",
  },
  "frontend/src/components/map/terrainRouter.ts": {
    "absent terrain tile":
      "a message the router matches to tell a tile that does not exist, never shown",
  },
  "frontend/src/components/plans/PlanDetailPanel.tsx": {
    "header button": SELECTOR,
  },
  "frontend/src/components/sidebar/panels/AnalyticsPanel.tsx": {
    "header button": SELECTOR,
  },
  "frontend/src/components/sidebar/panels/NotificationsPanel.tsx": {
    info: "the name of an icon",
    "var(--color-accent)": "a CSS colour variable",
  },
  "frontend/src/components/sidebar/panels/SettingsPanel.tsx": {
    "Logjam Web": PRODUCT,
  },
  "frontend/src/components/sidebar/panels/wayImport.ts": {
    "Upload failed (network error)": STORAGE_ERROR,
    "Upload failed (timeout)": STORAGE_ERROR,
    "Upload stalled": STORAGE_ERROR,
  },
  "frontend/src/csvImport/detectColumns.ts": {
    "place name": CSV_HEADER,
    "trip date": CSV_HEADER,
    "visit date": CSV_HEADER,
    "trip type": CSV_HEADER,
  },
  "frontend/src/csvImport/detectFileKind.ts": {
    "lat dd": CSV_HEADER,
    "latitude dd": CSV_HEADER,
    "lon dd": CSV_HEADER,
    "lng dd": CSV_HEADER,
    "longitude dd": CSV_HEADER,
  },
  "frontend/src/csvImport/placeColumns.ts": {
    "place name": CSV_HEADER,
    "alt names": CSV_HEADER,
    "alt name": CSV_HEADER,
    "alternative names": CSV_HEADER,
    "alternative name": CSV_HEADER,
    "other names": CSV_HEADER,
    "num abseils": CSV_HEADER,
    "number abseils": CSV_HEADER,
    "num raps": CSV_HEADER,
    "number of pitches": CSV_HEADER,
    "number of abseils": CSV_HEADER,
    "longest rap": CSV_HEADER,
    "longest abseil": CSV_HEADER,
    "longest pitch": CSV_HEADER,
    "max rap": CSV_HEADER,
    "max abseil": CSV_HEADER,
    "longest abseil m": CSV_HEADER,
    "longest rap m": CSV_HEADER,
    "trip time": CSV_HEADER,
    "trip duration": CSV_HEADER,
    "time hrs": CSV_HEADER,
    "hours hrs": CSV_HEADER,
    "vertical grade": CSV_HEADER,
    "a grade": CSV_HEADER,
    "aquatic grade": CSV_HEADER,
    "water grade": CSV_HEADER,
  },
  "frontend/src/geoPdf/draw/common.ts": {
    '"Source Sans 3"': FONT,
  },
  "frontend/src/geoPdf/pdf.ts": {
    "Logjam GeoPDF Generator":
      "the producer Logjam writes into a PDF and recognises on import",
  },
  "frontend/src/geoPdf/tiles.ts": {
    "archive changed while it was read":
      "the message of the mismatch the PMTiles library catches and retries on, never shown",
  },
  "frontend/src/ui/AttributeFilter.tsx": {
    "Less than": "a stored operator of a number filter",
  },
  "frontend/src/ui/Row.tsx": {
    "noopener noreferrer": "the rel of a link that opens a tab",
  },
  "mobile/src/geopdf/geoPdfImportsDb.ts": {
    "west = ?, south = ?, east = ?, north = ?": SQL_TEXT,
  },
  "mobile/src/map/BasemapThumb.tsx": {
    "Preview tiles: © OpenStreetMap contributors, OpenTopoMap and CyclOSM (CC BY-SA); © State of New South Wales (Spatial Services).":
      CREDIT,
  },
  "mobile/src/map/mapLabelText.ts": {
    "Noto Sans Medium": FONT,
  },
  "mobile/src/offline/wipedStores.ts": {
    "A sync cursor and a schema version: nothing the user made.": WIPE_NOTE,
    "Whether an import is drawn and where its bytes are: the file itself is a synced row.":
      WIPE_NOTE,
    "Working files, deleted after use.": WIPE_NOTE,
    "Research logs from a developer toggle that is off by default, with no coordinates in them.":
      WIPE_NOTE,
    "Forecasts, fetched again with one press.": WIPE_NOTE,
    "Public gauge readings, fetched again online.": WIPE_NOTE,
    "Map files, written again when the map opens.": WIPE_NOTE,
    "The account's list of sharpened areas, fetched again online.": WIPE_NOTE,
    "A plan's files, downloaded again from the plan with one press.": WIPE_NOTE,
  },
  "mobile/src/screens/settings/NotificationSettingsScreen.tsx": {
    "Logjam GPS": PRODUCT,
  },
  "mobile/src/sync/deltaPull.ts": {
    "…: … row(s) this app version cannot apply":
      "an entry in the list the delta pull only logs and counts, never shows",
  },
  "mobile/src/sync/mirrorSchema.ts": {
    "outbox(state, seq)": "an index definition in SQL",
  },
  "mobile/src/sync/outbox.ts": {
    label: "a column name in the table the update is built from",
  },
  "mobile/src/tracks/tracksDb.ts": {
    "distanceM = ?, durationMs = ?, elevationGainM = ?, elevationLossM = ?, elevationSource = ?, elevationCheckedFor = NULL":
      SQL_TEXT,
    "elevationGainM = ?, elevationLossM = ?, elevationSource = ?": SQL_TEXT,
  },
  "mobile/src/ui/AttributeFilter.tsx": {
    "Less than": "a stored operator of a number filter",
  },
  "api/src/lib/customFieldDefs.ts": { "custom field": DETAIL },
  "api/src/lib/env.ts": { "must be a bare semver like 1.2.3": ENV_MESSAGE },
  "api/src/lib/topoJobReaper.ts": { "Reaped by topo job reaper": STOP_REASON },
  "api/src/middleware/auth.ts": {
    "Missing or invalid authorization header": DETAIL,
    "Invalid or expired token": DETAIL,
    "Invalid token type": DETAIL,
    "Token is missing required identity claims": DETAIL,
  },
  "api/src/routes/media.ts": {
    "replaces must name your own uploaded track on this place": DETAIL,
  },
  "api/src/routes/ropewiki.ts": {
    "ropeWikiId … not found in current RopeWiki data": IMPORT_NOTE,
    "Target place … not owned by user": IMPORT_NOTE,
    "Target place … already linked to a RopeWiki page": IMPORT_NOTE,
  },
  "api/src/routes/topoJobs.ts": {
    "the owner's internal id; syncRole is the whole answer a recipient needs":
      DEV_NOTE,
    "raw bucket keys, and a key can name a place": DEV_NOTE,
    "Job deleted by user": STOP_REASON,
  },
  "api/src/scripts/announce.ts": {
    "the file must start with a `# ` title": CLI_REFUSAL,
    "the message has no body": CLI_REFUSAL,
    "Markdown in the title": CLI_REFUSAL,
  },
  "api/src/services/ropewiki.ts": {
    "Logjam/1.0 (canyoning logbook; https://logjam.earth; noreply@notifications.logjam.earth)":
      SENDER,
    "number of rappels": ROPEWIKI_COLUMN,
    "longest rappel": ROPEWIKI_COLUMN,
    "max time": ROPEWIKI_COLUMN,
    "min time": ROPEWIKI_COLUMN,
    'Row …: invalid PAGEID "…"': IMPORT_NOTE,
    "Row …: duplicate PAGEID …, first row kept": IMPORT_NOTE,
    "Row …: missing name": IMPORT_NOTE,
    'Row … (…): could not parse coordinates "…"': IMPORT_NOTE,
  },
};

export type BareLiteral = {
  line: number;
  /** Where the literal starts in the file (its node's `getStart()`): how a rewrite finds it again. */
  start: number;
  text: string;
  /** `copy` stood where today's copy rules read (JSX text, a prop such as `label`, a toast's argument); `prose` is any other literal that reads as a sentence; `word` is a one-word label outside both, found only when asked for. */
  why: "copy" | "prose" | "word";
};

/** A capitalised single word ("Friends", "Delete"): a label, or an id; the scanner cannot tell outside a copy position. */
const LABEL = /^\p{Lu}\p{Ll}+$/u;

/**
 * The literals a user may read that were not written through `t`, `plural`,
 * `rich` or `say`: any with a letter where `userFacingStrings` reads
 * (`COPY_PROPS`, `COPY_CALLS`, JSX text and child expressions), and any other
 * that reads as prose (`PROSE`) unless it stands in a position that is code:
 * an import, a type, a comparison, a log, `console`, an error's message, SQL,
 * a property's name, a styling or wiring attribute.
 *
 * `repoPath` is the file's path from the repo root: the literals
 * `DATA_LITERALS` lists for that file are left out. `keepData` reports them too,
 * which `i18nCoverage.test.ts` asks for to find an entry its file does not hold.
 *
 * `words` also reports a capitalised single word in those other positions
 * (`why: "word"`). The ratchet does not count them (a word there is as often an
 * id as a label), so only the codemod asks.
 */
export function bareCopyIn(
  tsModule: unknown,
  fileName: string,
  source: string,
  options: { words?: boolean; keepData?: boolean; repoPath?: string } = {},
): BareLiteral[] {
  const ts = tsModule as typeof TypeScript;
  const sf = loadFile(ts, fileName, source);
  const found: BareLiteral[] = [];
  const plurals = pluralNames(ts, sf);
  const data = options.repoPath ? DATA_LITERALS[options.repoPath] : undefined;
  const isData = (text: string) =>
    !!data && Object.prototype.hasOwnProperty.call(data, text);
  const add = (node: TypeScript.Node, text: string, copy: boolean) => {
    if (
      !/\p{L}/u.test(text) ||
      SQL.test(text) ||
      HEX.test(text) ||
      (!options.keepData && isData(text))
    )
      return;
    const prose = PROSE.test(text) && !CODE.test(text) && !isMarkup(text);
    const word = !!options.words && LABEL.test(text);
    if (!copy && !prose && !word) return;
    found.push({
      line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      start: node.getStart(),
      text,
      why: copy ? "copy" : prose ? "prose" : "word",
    });
  };
  // Outside a copy position, text built from pieces is one sentence: its static
  // text with a stand-in word for each substitution, judged as a whole. It needs
  // two words of its own, so `Bearer ${token}` and `${n} MB` are not sentences.
  const HOLE = "\uE000";
  const addJoined = (node: TypeScript.Node, joined: string) => {
    const words = joined.split(HOLE).join("xx");
    const written = joined.split(HOLE).join("…");
    if (
      (joined.split(HOLE).join(" ").match(WORDS_IN) ?? []).length < 2 ||
      SQL.test(written) ||
      !PROSE.test(words) ||
      CODE.test(words) ||
      isMarkup(written) ||
      (!options.keepData && isData(written))
    )
      return;
    found.push({
      line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      start: node.getStart(),
      text: written,
      why: "prose",
    });
  };
  const equality = new Set([
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.InKeyword,
  ]);
  const isPlus = (n: TypeScript.Node): n is TypeScript.BinaryExpression =>
    ts.isBinaryExpression(n) &&
    n.operatorToken.kind === ts.SyntaxKind.PlusToken;
  const plusOperands = (n: TypeScript.Node): TypeScript.Node[] =>
    isPlus(n) ? [...plusOperands(n.left), ...plusOperands(n.right)] : [n];
  const isTextLike = (n: TypeScript.Node) =>
    ts.isStringLiteralLike(n) || ts.isTemplateExpression(n);
  /** A piece's static text; each substitution, or an operand that is not text, is `HOLE`. */
  const joinedText = (n: TypeScript.Node): string =>
    ts.isStringLiteralLike(n)
      ? n.text
      : ts.isTemplateExpression(n)
        ? n.head.text +
          n.templateSpans.map((x) => HOLE + x.literal.text).join("")
        : HOLE;
  // `copy`: the value is where the net reads. A call or a function body ends
  // it: `friendShareVerb("unshare")` passes an id, not words.
  const visit = (node: TypeScript.Node, copy: boolean): void => {
    const into = (child: TypeScript.Node, c = copy) => visit(child, c);
    const all = (c = copy) => ts.forEachChild(node, (child) => visit(child, c));
    // `"a" + b`, `"a" ${b}` and `b || "a"`: text built or defaulted in place.
    const isText = (arg: TypeScript.Node): boolean =>
      ts.isStringLiteralLike(arg) ||
      ts.isTemplateExpression(arg) ||
      (ts.isBinaryExpression(arg) &&
        (arg.operatorToken.kind === ts.SyntaxKind.PlusToken ||
          arg.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          arg.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
        (isText(arg.left) || isText(arg.right)));
    // An error's message may also be chosen in place, `new Error(c ? "a" : "b")`;
    // a ternary handed to `.set(` or `.append(` can still be a sentence a screen shows.
    const isErrorText = (arg: TypeScript.Node): boolean =>
      isText(arg) ||
      (ts.isConditionalExpression(arg) &&
        (isErrorText(arg.whenTrue) || isErrorText(arg.whenFalse)));
    // `super("message")` in a class that extends an Error: its message is the developer's, as `new Error(...)`'s is.
    const isErrorSuper = (call: TypeScript.CallExpression): boolean => {
      if (call.expression.kind !== ts.SyntaxKind.SuperKeyword) return false;
      for (let n = call.parent; n; n = n.parent)
        if (ts.isClassLike(n))
          return !!n.heritageClauses?.some(
            (h) =>
              h.token === ts.SyntaxKind.ExtendsKeyword &&
              /^\w*Error$/.test(h.types[0]?.expression.getText() ?? ""),
          );
      return false;
    };
    // An argument that is text is code here; any other (a callback) is read.
    const codeArguments = (
      call: TypeScript.CallExpression | TypeScript.NewExpression,
      error = false,
    ) => {
      into(call.expression, false);
      for (const arg of call.arguments ?? [])
        if (!(error ? isErrorText : isText)(arg)) into(arg, false);
    };
    if (
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isExternalModuleReference(node) ||
      ts.isTypeNode(node) ||
      ts.isDecorator(node)
    )
      return;
    if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag.getText();
      if (MESSAGE_TAGS.has(tag) || NOT_COPY_TAGS.test(tag)) {
        // The text is the message or code; a hole's own strings are bare.
        if (ts.isTemplateExpression(node.template))
          for (const span of node.template.templateSpans)
            into(span.expression, false);
        return;
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText();
      // A log line is code throughout, nested fallbacks included:
      // `console.error(messageFromError(err, "Could not save"))`.
      if (CONSOLE.test(callee)) return;
      if (isErrorSuper(node)) return codeArguments(node, true);
      if (NOT_COPY_CALLS.test(callee)) return codeArguments(node);
      if (plurals.has(callee)) {
        node.arguments.forEach((arg, i) => {
          if (i !== 1 && i !== 2) into(arg, false);
        });
        return;
      }
      into(node.expression, false);
      const asCopy = COPY_CALLS.test(callee);
      const count = callee === "Alert.alert" ? 2 : 1;
      node.arguments.forEach((arg, i) => into(arg, asCopy && i < count));
      return;
    }
    if (
      ts.isNewExpression(node) &&
      NOT_COPY_NEW.test(node.expression.getText())
    )
      return codeArguments(node, /Error$/.test(node.expression.getText()));
    if (ts.isFunctionLike(node) && !ts.isArrowFunction(node)) return all(false);
    if (ts.isArrowFunction(node)) {
      for (const parameter of node.parameters) into(parameter, false);
      // A concise body is an expression the caller may show; a block is code.
      into(node.body, ts.isBlock(node.body) ? false : copy);
      return;
    }
    if (ts.isBinaryExpression(node) && equality.has(node.operatorToken.kind)) {
      // `x === "a"` compares; the other side may hold strings of its own.
      for (const side of [node.left, node.right])
        if (!ts.isStringLiteralLike(side)) into(side, false);
      return;
    }
    if (ts.isCaseClause(node)) {
      node.statements.forEach((s) => into(s, false));
      return;
    }
    if (ts.isElementAccessExpression(node)) {
      into(node.expression, false);
      return;
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText();
      const init = node.initializer;
      if (!init) return;
      const value =
        ts.isJsxExpression(init) && init.expression ? init.expression : init;
      if (COPY_PROPS.has(name)) into(value, true);
      else if (!NOT_COPY_ATTRS.test(name)) into(value, false);
      return;
    }
    if (ts.isJsxText(node)) return add(node, node.text.trim(), true);
    if (ts.isJsxExpression(node)) {
      // A child expression is on screen; an attribute's value is `into` above.
      const child =
        ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent);
      return all(child);
    }
    if (ts.isPropertyAssignment(node)) {
      const key = node.name.getText().replace(/["']/g, "");
      if (MAP_STYLE_KEY.test(key)) return;
      into(node.initializer, COPY_PROPS.has(key));
      return;
    }
    if (ts.isStringLiteralLike(node)) return add(node, node.text, copy);
    if (ts.isTemplateExpression(node)) {
      const parts = [
        node.head.text,
        ...node.templateSpans.map((s) => s.literal.text),
      ];
      if (parts.some((part) => SQL.test(part))) {
        for (const span of node.templateSpans) into(span.expression, false);
        return;
      }
      if (!copy) {
        addJoined(node, joinedText(node));
        for (const span of node.templateSpans) into(span.expression, false);
        return;
      }
      add(node.head, node.head.text, copy);
      for (const span of node.templateSpans) {
        into(span.expression, copy);
        add(span.literal, span.literal.text, copy);
      }
      return;
    }
    if (!copy && isPlus(node)) {
      const operands = plusOperands(node);
      if (operands.some(isTextLike)) {
        addJoined(node, operands.map(joinedText).join(""));
        for (const operand of operands)
          if (!isTextLike(operand)) into(operand, false);
          else if (ts.isTemplateExpression(operand))
            for (const span of operand.templateSpans)
              into(span.expression, false);
        return;
      }
    }
    all();
  };
  visit(sf, false);
  return found;
}

/** The modules the message functions come from: the package, and its own files that hold them. */
const MESSAGE_MODULE =
  /^@logjam\/shared$|(?:^|\/)(?:i18n|userSentence)(?:\.js)?$/;

const MESSAGE_FUNCTIONS = new Set([...MESSAGE_TAGS, "plural"]);

/**
 * Where a file brings in `t`, `say`, `rich` or `plural` under another name
 * (`import { t as tr }`) or through a namespace (`i18n.t`): the scanner finds
 * a message by the name it is written with, so such a message would go
 * uncounted and unchecked.
 *
 * It catches those two forms from `MESSAGE_MODULE` and no others: not
 * `export { t as tr }`, `const tr = t`, a default import, or a local function
 * named `t`, `say` or `rich`. None exists today.
 */
export function importProblems(
  tsModule: unknown,
  fileName: string,
  source: string,
): { line: number; problem: string }[] {
  const ts = tsModule as typeof TypeScript;
  const sf = loadFile(ts, fileName, source);
  const problems: { line: number; problem: string }[] = [];
  const namespaces = new Set<string>();
  const at = (node: TypeScript.Node, problem: string) =>
    problems.push({
      line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      problem,
    });
  for (const statement of sf.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !MESSAGE_MODULE.test(statement.moduleSpecifier.text)
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings))
      namespaces.add(bindings.name.text);
    else if (bindings)
      for (const element of bindings.elements)
        if (
          element.propertyName &&
          MESSAGE_FUNCTIONS.has(element.propertyName.text)
        )
          at(
            element,
            `${element.propertyName.text} is imported as ${element.name.text}: import it by its own name, so the scanner finds its messages`,
          );
  }
  const visit = (node: TypeScript.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      namespaces.has(node.expression.text) &&
      MESSAGE_FUNCTIONS.has(node.name.text)
    )
      at(
        node,
        `${node.getText()} reaches ${node.name.text} through a namespace: import it by its own name, so the scanner finds its messages`,
      );
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return problems;
}

/**
 * Whether the ratchet reads a directory entry: it walks into every folder but
 * `__tests__` and `__fixtures__`, and reads a `.ts` or `.tsx` file that is not
 * a test or a declaration. The four `i18nCoverage` tests and
 * `scripts/i18n-extract.mjs` pick files with this, so the codemod rewrites
 * what the ratchet counts.
 */
export function ratchetReads(name: string, isDirectory: boolean): boolean {
  return isDirectory
    ? !/^__(?:tests|fixtures)__$/.test(name)
    : /\.tsx?$/.test(name) && !/\.(test|d)\./.test(name);
}

/** The advice every bare-text failure ends with, up to the rows that say where the text is. */
const WRITE_THROUGH_T = `Write the text through t, plural, rich or say (${I18N_ADR}). A change that converts a whole directory runs \`node scripts/i18n-extract.mjs <directory>\` (after \`make shared\`), then \`node scripts/i18n-identity-check.mjs <base>\`. Where they are:`;

/** One row per file, with the lines of its hits, so a new literal can be found. */
function whereTheyAre(
  hits: readonly { file: string; line: number }[],
): string[] {
  const lines = new Map<string, number[]>();
  for (const hit of hits)
    lines.set(hit.file, [...(lines.get(hit.file) ?? []), hit.line]);
  return [...lines].map(([file, at]) => `  ${file}: ${at.join(", ")}`);
}

/**
 * What is wrong with the bare literals `found` in a package that holds none:
 * one failure naming how many there are and, per file, the lines. An empty list
 * means there is no bare text.
 */
export function bareCopyFailures(
  found: readonly { file: string; line: number }[],
): string[] {
  if (found.length === 0) return [];
  return [
    [
      `${found.length} bare literals. ${WRITE_THROUGH_T}`,
      ...whereTheyAre(found),
    ].join("\n"),
  ];
}

export type SourceScan = {
  /** Every message in the package, each with its file (relative to `src`). */
  messages: (SourceMessage & { file: string })[];
  /** Every bare literal outside `EXEMPT_FILES`, with its file. */
  bare: (BareLiteral & { file: string })[];
  /** Every message function imported under another name, with its file. */
  imports: { file: string; line: number; problem: string }[];
};

/** Scan one package's source. `files` are paths relative to its `src` (either separator); `pkg` is its folder at the repo root. */
export function scanSources(
  tsModule: unknown,
  pkg: string,
  files: readonly { path: string; source: string }[],
): SourceScan {
  const scan: SourceScan = { messages: [], bare: [], imports: [] };
  for (const { path: given, source } of files) {
    // One separator, so a path from any platform reads the same.
    const path = given.replace(/\\/g, "/");
    for (const message of messagesIn(tsModule, path, source))
      scan.messages.push({ ...message, file: path });
    for (const found of importProblems(tsModule, path, source))
      scan.imports.push({ ...found, file: path });
    if (`${pkg}/src/${path}` in EXEMPT_FILES || CATALOGUE_FILE.test(path))
      continue;
    for (const bare of bareCopyIn(tsModule, path, source, {
      repoPath: `${pkg}/src/${path}`,
    })) {
      scan.bare.push({ ...bare, file: path });
    }
  }
  return scan;
}

/** The catalogue's keys that no message in `keys` has: a message reworded, or removed, leaves its entry behind. */
export function orphanKeys(
  catalogue: Catalogue,
  keys: ReadonlySet<string>,
): string[] {
  return Object.keys(catalogue).filter((key) => !keys.has(key));
}

/**
 * The messages in `keys` that hold one of `words` (each a regular expression
 * matched from the start of a word, any case) but have no catalogue entry and
 * are not in `leftAsWritten` (message, then why): a spelling the language
 * writes differently, left as the source has it.
 */
export function missingEntries(
  catalogue: Catalogue,
  keys: ReadonlySet<string>,
  words: readonly string[],
  leftAsWritten: Readonly<Record<string, string>> = {},
): string[] {
  const wanted = words.map((word) => new RegExp(`\\b${word}`, "i"));
  const has = (table: object, key: string) =>
    Object.prototype.hasOwnProperty.call(table, key);
  return [...keys].filter(
    (key) =>
      wanted.some((re) => re.test(key)) &&
      !has(catalogue, key) &&
      !has(leftAsWritten, key),
  );
}

// Test-only minimal classic-PDF writer (fixture tier 1c).
//
// Emits a single-page PDF with an arbitrary /VP value (plus optional
// /LGIDict and /Producer) so parser tests can exercise every quirk and error
// code without committing binary fixtures. Classic xref table, no streams —
// deliberately the simplest structure pdf-lib will load.

export class PdfNameValue {
  constructor(readonly value: string) {}
}

export const pdfName = (value: string) => new PdfNameValue(value);

export type TestPdfValue =
  | number
  | string
  | PdfNameValue
  | TestPdfValue[]
  | { [key: string]: TestPdfValue };

function serialize(value: TestPdfValue): string {
  if (typeof value === "number") return String(value);
  if (value instanceof PdfNameValue) return `/${value.value}`;
  if (typeof value === "string") {
    return `(${value.replace(/([\\()])/g, "\\$1")})`;
  }
  if (Array.isArray(value)) return `[${value.map(serialize).join(" ")}]`;
  const entries = Object.entries(value)
    .map(([k, v]) => `/${k} ${serialize(v)}`)
    .join(" ");
  return `<< ${entries} >>`;
}

export interface TestPdfOptions {
  pageWidthPt?: number;
  pageHeightPt?: number;
  /** MediaBox lower-left corner. Non-zero exercises the render-box rebase. */
  mediaBoxOrigin?: { x: number; y: number };
  /** Page /CropBox, absolute user-space rect. */
  cropBox?: { x0: number; y0: number; x1: number; y1: number };
  /** Page /Rotate (0 | 90 | 180 | 270). */
  rotate?: number;
  /** Value of the page's /VP key; omit for no georef. */
  vp?: TestPdfValue;
  /** Adds a page-level /LGIDict (TerraGo marker). */
  lgiDict?: boolean;
  producer?: string;
}

export function buildTestPdf(options: TestPdfOptions): Uint8Array {
  const width = options.pageWidthPt ?? 421;
  const height = options.pageHeightPt ?? 298;

  const origin = options.mediaBoxOrigin ?? { x: 0, y: 0 };
  const pageEntries: string[] = [
    "/Type /Page",
    "/Parent 2 0 R",
    `/MediaBox [${origin.x} ${origin.y} ${origin.x + width} ${origin.y + height}]`,
  ];
  if (options.cropBox) {
    const { x0, y0, x1, y1 } = options.cropBox;
    pageEntries.push(`/CropBox [${x0} ${y0} ${x1} ${y1}]`);
  }
  if (options.rotate !== undefined)
    pageEntries.push(`/Rotate ${options.rotate}`);
  if (options.vp !== undefined)
    pageEntries.push(`/VP ${serialize(options.vp)}`);
  if (options.lgiDict) {
    pageEntries.push("/LGIDict << /Type /LGIDict /Version (2.1) >>");
  }

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< ${pageEntries.join(" ")} >>`,
    `<< /Producer (${(options.producer ?? "buildTestPdf").replace(/([\\()])/g, "\\$1")}) >>`,
  ];

  let body = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R >>\n`;
  body += `startxref\n${xrefStart}\n%%EOF\n`;

  return new TextEncoder().encode(body);
}

/**
 * A well-formed GEO viewport dict for tests to clone and mutate. Top-level
 * and measure-level overrides merge; an explicit `undefined` deletes the key.
 */
export function validVp(
  overrides: Record<string, TestPdfValue | undefined> = {},
  measureOverrides: Record<string, TestPdfValue | undefined> = {},
): TestPdfValue {
  const measure: { [key: string]: TestPdfValue } = {
    Type: pdfName("Measure"),
    Subtype: pdfName("GEO"),
    // BL, BR, TR, TL in (lat, lon)
    GPTS: [-33.7, 150.2, -33.7, 150.3, -33.6, 150.3, -33.6, 150.2],
    LPTS: [0, 0, 1, 0, 1, 1, 0, 1],
    GCS: {
      Type: pdfName("GEOGCS"),
      EPSG: 4326,
    },
  };
  for (const [k, v] of Object.entries(measureOverrides)) {
    if (v === undefined) delete measure[k];
    else measure[k] = v;
  }
  const vp: { [key: string]: TestPdfValue } = {
    Type: pdfName("Viewport"),
    BBox: [28, 28, 393, 270],
    Measure: measure,
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete vp[k];
    else vp[k] = v;
  }
  return vp;
}

// Measure overrides for validVp: sheets in projections that do not cover
// Sydney, over made-up boxes at published places. GPTS is (lat, lon) in
// BL, BR, TR, TL order; the WKT is the projection's public definition.
const box = (south: number, west: number, north: number, east: number) => [
  south,
  west,
  south,
  east,
  north,
  east,
  north,
  west,
];

const GRS80 = 'SPHEROID["GRS 1980",6378137,298.257222101]';
const DEGREE = 'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]';

/** NZTM2000 (EPSG:2193), a box in Wellington. */
export const NZTM_SHEET: Record<string, TestPdfValue> = {
  GPTS: box(-41.35, 174.75, -41.25, 174.85),
  GCS: {
    Type: pdfName("PROJCS"),
    EPSG: 2193,
    WKT: `PROJCS["NZGD2000 / New Zealand Transverse Mercator 2000",GEOGCS["NZGD2000",DATUM["New_Zealand_Geodetic_Datum_2000",${GRS80}],${DEGREE}],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",173],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",1600000],PARAMETER["false_northing",10000000],UNIT["metre",1]]`,
  },
};

/** WGS 84 / UTM zone 12N (EPSG:32612), a box at Salt Lake City. */
export const UTM12N_SHEET: Record<string, TestPdfValue> = {
  GPTS: box(40.65, -111.95, 40.75, -111.85),
  GCS: {
    Type: pdfName("PROJCS"),
    EPSG: 32612,
    WKT: `PROJCS["WGS 84 / UTM zone 12N",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],${DEGREE}],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-111],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1]]`,
  },
};

/** A Lambert azimuthal equal-area projection centred in the mid-Atlantic
 * (33.5 N, 29 W), WKT only, and a box at its centre. proj4 throws for a
 * point in Sydney, the antipode of that centre. */
export const ATLANTIC_LAEA_SHEET: Record<string, TestPdfValue> = {
  GPTS: box(33.45, -29.05, 33.55, -28.95),
  GCS: {
    Type: pdfName("PROJCS"),
    WKT: `PROJCS["Atlantic LAEA",GEOGCS["GRS80 sphere",DATUM["D_GRS80",${GRS80}],${DEGREE}],PROJECTION["Lambert_Azimuthal_Equal_Area"],PARAMETER["latitude_of_center",33.5],PARAMETER["longitude_of_center",-29],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1]]`,
  },
};

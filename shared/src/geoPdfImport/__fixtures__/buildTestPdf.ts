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
  /** Value of the page's /VP key; omit for no georef. */
  vp?: TestPdfValue;
  /** Adds a page-level /LGIDict (TerraGo marker). */
  lgiDict?: boolean;
  producer?: string;
}

export function buildTestPdf(options: TestPdfOptions): Uint8Array {
  const width = options.pageWidthPt ?? 421;
  const height = options.pageHeightPt ?? 298;

  const pageEntries: string[] = [
    "/Type /Page",
    "/Parent 2 0 R",
    `/MediaBox [0 0 ${width} ${height}]`,
  ];
  if (options.vp !== undefined) pageEntries.push(`/VP ${serialize(options.vp)}`);
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

// "Open in Logjam" (Android ACTION_VIEW / share-sheet) — Stage 5/6 intent
// handling. The OS hands the app a content:// (or file://) URI with no
// reliable filename or MIME, so the file KIND is classified by sniffing the
// leading bytes, never by extension.
//
// PRIVACY: the flow is identical to the picker imports — entirely
// device-local, no coordinates leave the device, errors are static strings.

export type IncomingFileKind = "pdf" | "gpx" | "kml" | "kmz" | "geojson";

/** Sniff the file kind from its leading bytes. Null ⇒ unsupported. */
export function classifyIncomingBytes(bytes: Uint8Array): IncomingFileKind | null {
  if (bytes.length < 4) return null;
  // %PDF
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "pdf";
  }
  // PK\x03\x04 — zip container; the vector importer digs the KML out.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "kmz";
  }
  const head = new TextDecoder()
    .decode(bytes.slice(0, 2048))
    .replace(/^﻿/, "")
    .trimStart();
  if (head.startsWith("{")) return "geojson";
  if (head.startsWith("<")) {
    // XML: root element decides. Search past the prolog/comments.
    if (/<gpx[\s>]/i.test(head)) return "gpx";
    if (/<kml[\s>]/i.test(head)) return "kml";
  }
  return null;
}

/** Synthetic filename for the extension-dispatching vector parser. */
export function syntheticNameFor(kind: Exclude<IncomingFileKind, "pdf">): string {
  return `Shared file.${kind}`;
}

/** True for URIs that carry a document (not app-scheme deep links). */
export function isFileIntentUrl(url: string): boolean {
  return url.startsWith("content://") || url.startsWith("file://");
}

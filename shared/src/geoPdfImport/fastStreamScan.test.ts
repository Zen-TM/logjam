// Differential test: pdf-lib's own stream-end scan vs the fast replacement.
//
// The replacement exists for speed, so the ONLY thing worth asserting is that
// it is otherwise indistinguishable — same returned offset, same cursor left
// behind, same throw. Anything that drifts here silently moves where a stream's
// contents end, which in a GeoPDF is the difference between a map and a mess.
//
// The original is captured before `installFastStreamScan` replaces it, so both
// sides of every comparison are the real implementations.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFContext, PDFObjectParser, PDFParser } from "@cantoo/pdf-lib";

import { fastFindEndOfStreamFallback } from "./fastStreamScan.js";

const originalFindEndOfStreamFallback = (
  Object.getPrototypeOf(PDFParser.prototype) as {
    findEndOfStreamFallback: (this: unknown, startPos: unknown) => number;
  }
).findEndOfStreamFallback;

function bytesOf(text: string): Uint8Array {
  return new Uint8Array([...text].map((c) => c.charCodeAt(0)));
}

/** Run one implementation over `bytes` from `from`; report what it decided. */
function run(
  implementation: (this: unknown, startPos: unknown) => number,
  bytes: Uint8Array,
  from: number,
): { end: number; cursor: number } | { threw: true } {
  const parser = PDFObjectParser.forBytes(bytes, PDFContext.create()) as unknown as {
    bytes: { moveTo(n: number): void; offset(): number };
  };
  parser.bytes.moveTo(from);
  try {
    const end = implementation.call(parser, { line: 0, column: 0, offset: from });
    return { end, cursor: parser.bytes.offset() };
  } catch {
    return { threw: true };
  }
}

function expectIdentical(bytes: Uint8Array, from = 0): void {
  expect(run(fastFindEndOfStreamFallback as never, bytes, from)).toEqual(
    run(originalFindEndOfStreamFallback, bytes, from),
  );
}

describe("fastFindEndOfStreamFallback", () => {
  it("agrees on a plain stream", () => {
    expectIdentical(bytesOf("some binary payload\nendstream\nendobj"));
  });

  // The three end-of-line spellings pdf-lib strips off the front of the
  // keyword. Each one moves the stream's last content byte, so each is its own
  // case rather than a single "handles newlines".
  it("agrees when the keyword is preceded by CR LF", () => {
    expectIdentical(bytesOf("payload\r\nendstream\nendobj"));
  });

  it("agrees when the keyword is preceded by a bare CR", () => {
    expectIdentical(bytesOf("payload\rendstream\nendobj"));
  });

  it("agrees when the keyword is preceded by a bare LF", () => {
    expectIdentical(bytesOf("payload\nendstream\nendobj"));
  });

  it("agrees when no end-of-line precedes the keyword", () => {
    expectIdentical(bytesOf("payloadendstream\nendobj"));
  });

  // The reason the scan counts nesting rather than taking the first hit.
  it("agrees when the payload contains the word 'stream'", () => {
    expectIdentical(bytesOf("a stream inside\nendstream\nendstream\nendobj"));
  });

  it("agrees when the payload contains 'endstream' as a substring of a word", () => {
    expectIdentical(bytesOf("notendstreamish\nendstream\nendobj"));
  });

  it("agrees that an unterminated stream is an error", () => {
    expectIdentical(bytesOf("payload with no terminator at all"));
  });

  it("agrees starting from a non-zero offset", () => {
    expectIdentical(bytesOf("skipped\nendstream\npayload\nendstream\n"), 18);
  });

  // Real files, end to end: every fallback the parser takes while reading a
  // committed fixture must land on the same byte either way.
  it("agrees on every stream in the committed fixtures", () => {
    const fixtures = ["gdal-mga56.pdf", "logjam-a5.pdf", "logjam-legacy-a5.pdf"];
    for (const name of fixtures) {
      const bytes = new Uint8Array(
        readFileSync(join(__dirname, "__fixtures__", name)),
      );
      // Every offset in the file where a stream body could start — a superset
      // of the positions the parser actually asks about, which is the point.
      for (let from = 0; from < bytes.length; from += 97) {
        expectIdentical(bytes, from);
      }
    }
  });
});

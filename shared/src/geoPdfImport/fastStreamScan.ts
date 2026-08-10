// Makes pdf-lib's stream-end scan fast enough to run on a phone.
//
// THE PROBLEM. A PDF stream declares its byte length as `/Length`, and writers
// that don't know the length until the stream is written emit it as an INDIRECT
// reference (`/Length 42 0 R`) — which is what the NSW topo GeoPDFs do for 540
// of their 541 streams. pdf-lib only takes the fast path when `/Length` is a
// literal number; for a reference it falls back to scanning forward for
// `endstream` ONE BYTE AT A TIME in JavaScript.
//
// On V8 that is unremarkable: the whole parse of an 8 MB sheet takes ~480 ms.
// On Hermes — a bytecode interpreter with no JIT — the same 7.8 MB of scanning
// took THIRTY-FIVE SECONDS, of which a single 3.9 MB stream was one unbroken
// 16.8-second block of the UI thread. pdf-lib's own cooperative yielding
// (`parseSpeed`) can't help: it yields between OBJECTS, and this is one object.
//
// THE FIX. The scan looks for exactly two keywords, `stream` and `endstream`,
// and every occurrence of either contains the literal `stream`. So instead of
// testing six keywords at every byte, jump straight to the next `stream` with
// `Uint8Array.prototype.indexOf` — a native builtin, so the scanning itself
// runs at native speed — and classify the hit by looking at the three bytes in
// front of it. Same algorithm, same results, ~1% of the interpreted work.
//
// This is a monkey-patch of a dependency's internals, which is not free: it is
// pinned to a method name and its exact semantics. Both are covered by
// `fastStreamScan.test.ts`, which runs the original and this side by side over
// real files and asserts every returned offset matches. If pdf-lib changes the
// method away, `installFastStreamScan` throws rather than silently doing
// nothing — a silent no-op here reads as "the phone got slower".
import { PDFParser } from "@cantoo/pdf-lib";

const CARRIAGE_RETURN = 0x0d;
const NEWLINE = 0x0a;
/** "stream" — also the tail of "endstream", which is what makes one scan do. */
const STREAM = [0x73, 0x74, 0x72, 0x65, 0x61, 0x6d];
/** The "end" in front of an "endstream". */
const END = [0x65, 0x6e, 0x64];

function matchesAt(bytes: Uint8Array, at: number, expected: number[]): boolean {
  if (at < 0 || at + expected.length > bytes.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (bytes[at + i] !== expected[i]) return false;
  }
  return true;
}

/** Index of the next literal `stream` at or after `from`; -1 when there is none. */
function indexOfStreamKeyword(bytes: Uint8Array, from: number): number {
  let at = from;
  for (;;) {
    // The native builtin does the scanning. This is the whole optimisation.
    const candidate = bytes.indexOf(STREAM[0], at);
    if (candidate < 0) return -1;
    if (matchesAt(bytes, candidate, STREAM)) return candidate;
    at = candidate + 1;
  }
}

/**
 * Where an `endstream` keyword's match STARTS, including any end-of-line bytes
 * pdf-lib treats as part of it.
 *
 * This is what decides the stream's last content byte, so the order matters and
 * mirrors pdf-lib's: it tries CR LF, then CR, then LF, then the bare keyword,
 * and the first hit wins. Getting it wrong would leave a stray newline on the
 * end of every stream's contents.
 */
function keywordStartWithEol(bytes: Uint8Array, endstreamAt: number): number {
  if (
    bytes[endstreamAt - 2] === CARRIAGE_RETURN &&
    bytes[endstreamAt - 1] === NEWLINE
  ) {
    return endstreamAt - 2;
  }
  if (bytes[endstreamAt - 1] === CARRIAGE_RETURN) return endstreamAt - 1;
  if (bytes[endstreamAt - 1] === NEWLINE) return endstreamAt - 1;
  return endstreamAt;
}

interface ByteStreamLike {
  bytes: Uint8Array;
  length: number;
  offset(): number;
  moveTo(offset: number): void;
}

interface ParserLike {
  bytes: ByteStreamLike;
}

export function fastFindEndOfStreamFallback(
  this: ParserLike,
  startPos: unknown,
): number {
  const stream = this.bytes;
  const bytes = stream.bytes;
  // Nesting: pdf-lib counts an inner `stream` as opening another level, so a
  // stream whose bytes happen to contain the word doesn't end the outer one
  // early. Kept exactly, cheap, and the reason this isn't just "find the next
  // endstream".
  let nesting = 1;
  let cursor = stream.offset();
  let end = cursor;

  while (cursor < stream.length) {
    const at = indexOfStreamKeyword(bytes, cursor);
    if (at < 0) break;
    if (matchesAt(bytes, at - END.length, END)) {
      end = keywordStartWithEol(bytes, at - END.length);
      nesting -= 1;
    } else {
      end = at;
      nesting += 1;
    }
    cursor = at + STREAM.length;
    if (nesting === 0) break;
  }

  if (nesting !== 0) {
    // pdf-lib's own error for this, thrown the same way so callers that
    // recognise it still do. Its message carries a position, never content.
    throw new Error(
      `Failed to parse PDF stream starting at ${JSON.stringify(startPos)}`,
    );
  }
  stream.moveTo(cursor);
  return end;
}

let installed = false;

/**
 * Swap the slow scan for the fast one, once per process. Idempotent.
 *
 * Note the one behavioural difference: pdf-lib's scan advances byte by byte and
 * keeps a line/column count as it goes, and this one jumps. Line and column
 * therefore drift for the remainder of the file — they appear only in parser
 * ERROR messages, never in a parse result, and the trade is a message that says
 * the wrong line against an import that takes half a minute of frozen app.
 */
export function installFastStreamScan(): void {
  if (installed) return;
  const objectParserProto = Object.getPrototypeOf(PDFParser.prototype) as
    | Record<string, unknown>
    | null;
  if (
    !objectParserProto ||
    typeof objectParserProto.findEndOfStreamFallback !== "function"
  ) {
    // Fail loudly: pdf-lib has moved, and the quiet version of this failure is
    // an import that is inexplicably 70× slower on device than in tests.
    throw new Error(
      "pdf-lib's findEndOfStreamFallback is missing — fastStreamScan needs updating",
    );
  }
  objectParserProto.findEndOfStreamFallback = fastFindEndOfStreamFallback;
  installed = true;
}

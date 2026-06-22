import pino from "pino";
import { getEnv } from "./env";

const env = getEnv();

// Redact paths that could leak canyon coordinates or names into logs.
// Pino redaction is shallow on nested objects unless the path is exact;
// enumerate every known leak vector for canyon/trip-log payloads.
export const redactPaths = [
  // Express request body shapes for canyon/trip endpoints
  'req.body.latitude',
  'req.body.longitude',
  'req.body.name',
  'req.body.altNames',
  'req.body.notes',
  'req.body.coords',
  'req.body.coordinates',
  'req.body.canyon.latitude',
  'req.body.canyon.longitude',
  'req.body.canyon.name',
  'req.body.canyon.notes',
  // Generic wildcards for nested payloads
  '*.latitude',
  '*.longitude',
  '*.coords',
  '*.coordinates',
  // Array-shaped bulk-import/bulk-create payloads carry user-typed canyon/trip
  // names that the *.latitude wildcard can't reach (it only matches coordinate
  // keys). Unproven hardening: no log site currently emits req.body for these
  // routes (canyonsBulk/tripLogsBulk/imports log nothing; pino-http omits the
  // body; errorHandler logs safeErrorForLog(err), not the body), but redacting
  // them belt-and-braces guards the mandatory privacy boundary if a future log
  // site ever carries the payload. See PRIV-001 defence-in-depth.
  'req.body.rows[*].data.name',
  'req.body.rows[*].data.altNames',
  'req.body.rows[*].data.notes',
  'req.body.rows[*].data.latitude',
  'req.body.rows[*].data.longitude',
  'req.body.trips[*].name',
  'req.body.trips[*].notes',
  'req.body.canyons[*].name',
  'req.body.canyons[*].altNames',
  'req.body.canyons[*].notes',
  'req.body.canyons[*].latitude',
  'req.body.canyons[*].longitude',
  'req.body.displayName',
  // Authorization headers (never log credentials)
  'req.headers.authorization',
  'req.headers["x-fake-auth"]',
  'req.headers.cookie',
];

/**
 * Strip tile URLs and z/x/y tile-index triples from a log message. A web-
 * mercator tile index at the zooms we render (up to z18) localises a map area
 * to ~150 m — an approximate coordinate, which the CLAUDE.md privacy rule
 * forbids in logs. Pino redact paths cannot help with pre-interpolated
 * strings (e.g. fetch errors embedding the request URL), so coordinate-
 * bearing fragments are removed before the message is logged at all.
 */
export function redactTilePathPatterns(message: string): string {
  return message
    .replace(/\bhttps?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\b\d+\/\d+\/\d+\b/g, "[redacted-tile]");
}

/**
 * Build a privacy-safe projection of a thrown error for logging.
 *
 * Pino's `redact.paths` only censor STRUCTURED keys (e.g. `req.body.name`); they
 * cannot scrub free text embedded inside an Error's `message`/`stack`. Prisma is
 * the concrete leak vector: a `PrismaClientValidationError` (e.g. a bulk-import
 * row with a wrong-typed field that our hand validators don't cover) renders the
 * FULL query arguments — including canyon `name`, `latitude`, `longitude`,
 * `notes` — into `err.message` AND `err.stack`. Logging the raw `{ err }` (pino's
 * default Error serializer emits message + stack) would put canyon names/coords
 * in plaintext logs, violating the root CLAUDE.md privacy rule.
 *
 * So: never log the raw Error. Log only the class name plus a scrubbed message
 * with any rendered argument block removed and URLs/tiles redacted. The stack is
 * dropped entirely (it re-embeds the args); the class name + reqId are enough to
 * locate the throw site. Non-Prisma, coordinate-free errors keep their message
 * intact (matched verbatim by the unit tests).
 */
export function safeErrorForLog(err: unknown): {
  name: string;
  message: string;
} {
  if (!(err instanceof Error)) {
    return { name: "NonError", message: redactTilePathPatterns(String(err)) };
  }
  let message = err.message;
  // Strip Prisma's rendered invocation-argument block. Prisma formats validation
  // /known-request errors as:
  //   Invalid `prisma.canyon.createMany()` invocation\n\n<reason>\n{ ...args }
  // The trailing `{ ... }` (often multi-line) is the user-supplied data — drop
  // everything from the first brace that starts an args/object render onward.
  const argsBlockIndex = message.search(/\n\s*[{[]/);
  if (argsBlockIndex !== -1) {
    message = `${message.slice(0, argsBlockIndex)}\n[redacted-args]`;
  }
  return {
    name: err.name || "Error",
    message: redactTilePathPatterns(message),
  };
}

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: redactPaths,
    censor: '[redacted]',
  },
  base: { env: env.NODE_ENV },
});

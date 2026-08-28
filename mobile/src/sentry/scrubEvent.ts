// Privacy scrubber for crash/error reports (pure — vitest-tested; the Sentry
// binding lives in initSentry.ts).
//
// Mirrors api/src/lib/logger.ts: no canyon coordinates or names may leave the
// device in a crash report (root CLAUDE.md privacy rule). Three layers:
//   1. redactTilePathPatterns semantics — strip URLs, decimal lat/lng pairs
//      and z/x/y tile triples from every free-text field (a tile index at z18
//      localises to ~150 m).
//   2. safeErrorForLog semantics — drop stack-embedded argument blocks from
//      exception messages.
//   3. Structured-key redaction — censor coordinate/name-shaped keys anywhere
//      in breadcrumb data, extra, or contexts (parallel to logger.ts
//      redactPaths, but recursive because Sentry payloads are free-form).
//
// This module must ship BEFORE any Sentry init does (PROGRESS.md: reporter
// without scrubber = build-breaker).

// A decimal lat/lng pair in free text — "-33.5621, 150.4017", "[150.40,-33.56]"
// and the GeoJSON-ish forms in between. Keyed redaction (SENSITIVE_KEYS) cannot
// reach a coordinate that was interpolated into a message before it got here,
// and console.log/warn arrive as breadcrumbs through this same filter, so this
// is the only layer standing between an interpolated fix and Sentry.
//
// Four decimal places (~11 m) is the floor: below that the false-positive rate
// on ordinary numbers (timings, versions, ratios) costs more debuggability than
// the ~1 km it would protect. Anything the app formats from a real GPS fix has
// more precision than that, not less.
const COORDINATE_PAIR = /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g;

export function redactTilePathPatterns(message: string): string {
  return message
    .replace(/\bhttps?:\/\/\S+/gi, "[redacted-url]")
    .replace(COORDINATE_PAIR, "[redacted-coords]")
    .replace(/\b\d+\/\d+\/\d+\b/g, "[redacted-tile]");
}

/** Drop a rendered argument/object block from an error message (Prisma-style
 * multi-line `{ ... }` renders re-embed user data). */
export function stripArgsBlock(message: string): string {
  const argsBlockIndex = message.search(/\n\s*[{[]/);
  if (argsBlockIndex !== -1) {
    return `${message.slice(0, argsBlockIndex)}\n[redacted-args]`;
  }
  return message;
}

export function scrubMessage(message: string): string {
  return redactTilePathPatterns(stripArgsBlock(message));
}

// Keys whose values could carry canyon coordinates or names. Mirrors the
// intent of logger.ts redactPaths; matched case-insensitively at any depth.
const SENSITIVE_KEYS = new Set([
  "latitude",
  "longitude",
  "lat",
  "lng",
  "lon",
  "coords",
  "coordinates",
  "name",
  "altnames",
  "notes",
  "displayname",
  "authorization",
  "cookie",
]);

const MAX_DEPTH = 8;

/** Recursively censor sensitive keys and scrub string values in a free-form
 * payload (breadcrumb data / extra / contexts). Returns a new structure. */
export function scrubStructure(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[redacted-depth]";
  if (typeof value === "string") return redactTilePathPatterns(value);
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => scrubStructure(item, depth + 1));
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = "[redacted]";
    } else {
      result[key] = scrubStructure(val, depth + 1);
    }
  }
  return result;
}

// Minimal structural types for the slices of a Sentry event we touch — no
// @sentry import so this stays pure and testable. All-optional and free of
// index signatures so Sentry's own Event/Breadcrumb types satisfy them
// structurally.
export type ScrubbableBreadcrumb = {
  message?: string;
  category?: string;
  data?: { [key: string]: unknown };
};

// The frame fields that can carry user data: a bundle path (a full http:// URL
// under Metro), the source line an error was thrown from, and `vars` — local
// variables, which are exactly where a coordinate would be sitting. Spelled
// out rather than an index signature so Sentry's own StackFrame satisfies it.
export type ScrubbableStackFrame = {
  filename?: string;
  abs_path?: string;
  module?: string;
  function?: string;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  vars?: { [key: string]: unknown };
};

export type ScrubbableEvent = {
  message?: string;
  exception?: {
    values?: {
      type?: string;
      value?: string;
      stacktrace?: { frames?: ScrubbableStackFrame[] };
    }[];
  };
  breadcrumbs?: ScrubbableBreadcrumb[];
  request?: unknown;
  extra?: { [key: string]: unknown };
  contexts?: { [key: string]: unknown };
  user?: unknown;
};

/**
 * Scrub a Sentry event in place-of (returns a modified copy of the fields we
 * touch). Wire as `beforeSend`.
 */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  const scrubbed: ScrubbableEvent = { ...event };
  if (typeof scrubbed.message === "string") {
    scrubbed.message = scrubMessage(scrubbed.message);
  }
  if (scrubbed.exception?.values) {
    scrubbed.exception = {
      ...scrubbed.exception,
      values: scrubbed.exception.values.map((v) => ({
        ...v,
        ...(typeof v.value === "string" && { value: scrubMessage(v.value) }),
        // Frames are free-form enough to deserve the recursive walk: bundle
        // paths, the throwing source line, and `vars` all land here untouched
        // by the message-level scrub above.
        ...(v.stacktrace && {
          stacktrace: scrubStructure(v.stacktrace) as typeof v.stacktrace,
        }),
      })),
    };
  }
  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map((crumb) => scrubBreadcrumb(crumb));
  }
  // Request payloads can embed full URLs (tile paths) — drop wholesale.
  if ("request" in scrubbed) delete scrubbed.request;
  // The device user is identified server-side by their token; crash reports
  // need no identity beyond the anonymous install (sendDefaultPii is false,
  // but drop defensively).
  if ("user" in scrubbed) delete scrubbed.user;
  if (scrubbed.extra) {
    scrubbed.extra = scrubStructure(scrubbed.extra) as Record<string, unknown>;
  }
  if (scrubbed.contexts) {
    scrubbed.contexts = scrubStructure(scrubbed.contexts) as Record<string, unknown>;
  }
  return scrubbed as E;
}

/**
 * Scrub a single breadcrumb. Wire as `beforeBreadcrumb`. Network breadcrumbs
 * (fetch/xhr) carry request URLs — scrubbed like everything else; the URL
 * itself becomes [redacted-url] so timing/status survive but paths don't.
 */
export function scrubBreadcrumb<B extends ScrubbableBreadcrumb>(crumb: B): B {
  const scrubbed: ScrubbableBreadcrumb = { ...crumb };
  if (typeof scrubbed.message === "string") {
    scrubbed.message = scrubMessage(scrubbed.message);
  }
  if (scrubbed.data) {
    scrubbed.data = scrubStructure(scrubbed.data) as Record<string, unknown>;
  }
  return scrubbed as B;
}

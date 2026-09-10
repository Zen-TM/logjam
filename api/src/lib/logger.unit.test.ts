import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import {
  redactPaths,
  redactTilePathPatterns,
  safeErrorForLog,
  serializeRequestForLog,
} from "./logger";

// Build a pino logger using the SAME redact paths the app logger uses, but
// writing to an in-memory buffer so we can assert what actually gets censored.
// This guards the CLAUDE.md privacy rule: place coords/names must never reach
// logs in plain text.
function captureLog(obj: unknown): Record<string, unknown> {
  const lines: string[] = [];
  const stream: pino.DestinationStream = { write: (s: string) => void lines.push(s) };
  const log = pino(
    { redact: { paths: redactPaths, censor: "[redacted]" } },
    stream,
  );
  log.info(obj as object, "msg");
  return JSON.parse(lines[0]);
}

describe("logger redaction", () => {
  it("censors place coordinates and name in a request body", () => {
    const out = captureLog({
      req: { body: { latitude: -33.5, longitude: 150.3, name: "Secret Place", notes: "beta" } },
    });
    const body = (out.req as { body: Record<string, unknown> }).body;
    expect(body.latitude).toBe("[redacted]");
    expect(body.longitude).toBe("[redacted]");
    expect(body.name).toBe("[redacted]");
    expect(body.notes).toBe("[redacted]");
  });

  it("censors nested place coordinates via wildcard paths", () => {
    const out = captureLog({ anything: { latitude: -33.5, longitude: 150.3, coords: [1, 2] } });
    const nested = out.anything as Record<string, unknown>;
    expect(nested.latitude).toBe("[redacted]");
    expect(nested.longitude).toBe("[redacted]");
    expect(nested.coords).toBe("[redacted]");
  });

  it("masks authorization and cookie headers", () => {
    const out = captureLog({
      req: { headers: { authorization: "Bearer secret", cookie: "session=abc" } },
    });
    const headers = (out.req as { headers: Record<string, unknown> }).headers;
    expect(headers.authorization).toBe("[redacted]");
    expect(headers.cookie).toBe("[redacted]");
  });

  it("leaves non-sensitive fields intact", () => {
    const out = captureLog({ req: { body: { id: "place-1" } } });
    const body = (out.req as { body: Record<string, unknown> }).body;
    expect(body.id).toBe("place-1");
  });

  // PRIV-001 defence-in-depth: array-shaped bulk-import/create payloads carry
  // user-typed names the coordinate wildcards can't reach. No log site emits
  // these today (unproven hardening), but the redact paths must censor them if
  // one ever does.
  it("censors array-shaped bulk-import place names/coords", () => {
    const out = captureLog({
      req: {
        body: {
          rows: [
            { data: { name: "Secret Place", latitude: -33.5, longitude: 150.3, altNames: ["X"], notes: "beta" } },
          ],
        },
      },
    });
    const row = ((out.req as { body: { rows: Array<{ data: Record<string, unknown> }> } }).body.rows)[0].data;
    expect(row.name).toBe("[redacted]");
    expect(row.latitude).toBe("[redacted]");
    expect(row.longitude).toBe("[redacted]");
    expect(row.altNames).toBe("[redacted]");
    expect(row.notes).toBe("[redacted]");
  });

  // PLACE FIELD VALUES. A user-authored field label names the thing it
  // describes and its value is whatever they typed, so both are as sensitive as
  // notes — and NO existing wildcard reaches them: the `*.latitude` family
  // matches coordinate keys BY NAME, and a field value can be keyed anything.
  // The whole object is censored because the keys are user-authored too.
  it("censors place field values, whose keys the coordinate wildcards cannot match", () => {
    const out = captureLog({
      req: {
        body: {
          fieldValues: { rap_2_anchor: "tree on the true left", v_grade: 4 },
          foreignFields: [
            { key: "bolt_count", label: "Bolt count", type: "integer", value: 3 },
          ],
        },
      },
    });
    const body = (out.req as { body: Record<string, unknown> }).body;
    expect(body.fieldValues).toBe("[redacted]");
    expect(body.foreignFields).toBe("[redacted]");
  });

  // THE SYNC PUSH is the phone's only write path: every place the app has ever
  // created reached the server inside `ops[*].fields`, which no path in the list
  // reached until 2026-09-10.
  it("censors a place inside a sync push op", () => {
    const out = captureLog({
      req: {
        body: {
          protocol: 1,
          ops: [
            {
              opId: "op-1",
              entity: "place",
              op: "create",
              id: "p1",
              fields: {
                name: "Secret Canyon",
                notes: "abseil from the tree",
                latitude: -33.5,
                longitude: 150.4,
                tags: ["locked gate"],
                fieldValues: { access_beta: "gate code 1234" },
              },
            },
          ],
        },
      },
    });
    const op = (
      (out.req as { body: { ops: { fields: Record<string, unknown> }[] } }).body.ops
    )[0].fields;
    for (const key of ["name", "notes", "latitude", "longitude", "tags", "fieldValues"]) {
      expect(op[key], `${key} leaked out of a push op`).toBe("[redacted]");
    }
    // The envelope is not sensitive and stays readable — an id and an entity
    // name are what makes a log line useful at all.
    const body = out.req as { body: { ops: { entity: string }[] } };
    expect(body.body.ops[0].entity).toBe("place");
  });

  // A place's TAGS are the user's own words about it, and a definition's LABEL
  // is the same class of text on another route.
  it("censors a place's tags and a field definition's label", () => {
    const out = captureLog({
      req: { body: { tags: ["leech hollow"], label: "Which slot for the exit" } },
    });
    const body = (out.req as { body: Record<string, unknown> }).body;
    expect(body.tags).toBe("[redacted]");
    expect(body.label).toBe("[redacted]");
  });

  it("censors field values inside a bulk-import row", () => {
    const out = captureLog({
      req: {
        body: {
          rows: [
            { data: { name: "Secret Place", fieldValues: { access_beta: "gate code 1234" } } },
          ],
        },
      },
    });
    const row = ((out.req as { body: { rows: Array<{ data: Record<string, unknown> }> } }).body.rows)[0].data;
    expect(row.fieldValues).toBe("[redacted]");
  });

  it("censors array-shaped bulk trip names", () => {
    const out = captureLog({ req: { body: { trips: [{ name: "Secret trip", notes: "beta" }] } } });
    const trip = ((out.req as { body: { trips: Array<Record<string, unknown>> } }).body.trips)[0];
    expect(trip.name).toBe("[redacted]");
    expect(trip.notes).toBe("[redacted]");
  });
});

// Guards the SEC-002 boundary: tile z/x/y indices are approximate coordinates
// and must never reach logs, even embedded in fetch-error URLs.
describe("redactTilePathPatterns", () => {
  it("strips a full tile URL including host and z/x/y path", () => {
    const out = redactTilePathPatterns(
      "Failed: https://tiles.example/17/120342/78711.png 404",
    );
    expect(out).not.toMatch(/tiles\.example/);
    expect(out).not.toMatch(/\d+\/\d+\/\d+/);
    expect(out).toContain("[redacted-url]");
    expect(out).toContain("404");
  });

  it("strips a bare z/x/y triple", () => {
    expect(redactTilePathPatterns("tile 12/3456/7890 failed")).toBe(
      "tile [redacted-tile] failed",
    );
  });

  it("strips multiple triples and URLs in one message", () => {
    const out = redactTilePathPatterns(
      "retry 14/123/456 then http://cdn.example/15/7/8.png and 16/99/100",
    );
    expect(out).not.toMatch(/\d+\/\d+\/\d+/);
    expect(out).not.toMatch(/cdn\.example/);
  });

  it("leaves coordinate-free messages unchanged", () => {
    expect(redactTilePathPatterns("HTTP 404")).toBe("HTTP 404");
    expect(redactTilePathPatterns("Error: socket hang up")).toBe(
      "Error: socket hang up",
    );
  });
});

// Guards the SEC-001 (DoD) boundary: pino redact paths cannot scrub free text
// inside err.message/err.stack, and Prisma renders user-supplied place
// name/coords into a validation error's message. safeErrorForLog must drop the
// rendered argument block before it can reach logs.
describe("safeErrorForLog", () => {
  it("strips a Prisma rendered-args block carrying place name/coords", () => {
    const err = new Error(
      "Invalid `prisma.place.createMany()` invocation\n\n" +
        "Argument `notes`: Invalid value provided. Expected String or Null, provided Int.\n" +
        '{ name: "Secret Slot Place", latitude: -33.7, longitude: 150.3, notes: 12345 }',
    );
    err.name = "PrismaClientValidationError";
    const safe = safeErrorForLog(err);
    expect(safe.name).toBe("PrismaClientValidationError");
    expect(safe.message).not.toMatch(/Secret Slot Place/);
    expect(safe.message).not.toMatch(/-33\.7|150\.3/);
    expect(safe.message).toContain("[redacted-args]");
    // The reason line survives so the throw site is still diagnosable.
    expect(safe.message).toContain("Expected String or Null");
  });

  it("never carries the stack (which re-embeds the args)", () => {
    const err = new Error("boom { name: \"X\" }");
    const safe = safeErrorForLog(err) as Record<string, unknown>;
    expect(safe).not.toHaveProperty("stack");
  });

  it("leaves a plain coordinate-free error message intact", () => {
    const safe = safeErrorForLog(new Error("connection refused"));
    expect(safe.message).toBe("connection refused");
    expect(safe.name).toBe("Error");
  });

  it("redacts tile/url fragments embedded in an error message", () => {
    const safe = safeErrorForLog(new Error("fetch failed https://tiles.example/17/120/78.png"));
    expect(safe.message).not.toMatch(/tiles\.example/);
    expect(safe.message).toContain("[redacted-url]");
  });

  // Mirrors COORDINATE_PAIR in mobile/src/sentry/scrubEvent.ts — the same rule
  // on both sides of the API. Keyed redaction cannot reach a coordinate that
  // was interpolated into a message before it arrived here.
  it("redacts a decimal lat/lng pair interpolated into an error message", () => {
    const safe = safeErrorForLog(
      new Error("failed to place waypoint at -33.5621, 150.4017 for job"),
    );
    expect(safe.message).not.toMatch(/33\.5621/);
    expect(safe.message).not.toMatch(/150\.4017/);
    expect(safe.message).toContain("[redacted-coords]");
  });

  it("redacts coordinate pairs in bracketed / lng-first forms", () => {
    for (const text of [
      "[150.40170,-33.56210]",
      "point(-33.56210 , 150.40170)",
      "-33.5621,150.4017",
    ]) {
      expect(redactTilePathPatterns(text)).toContain("[redacted-coords]");
    }
  });

  it("leaves low-precision and non-coordinate number pairs alone", () => {
    // Four decimals is the floor: below it the false-positive rate on ordinary
    // numbers costs more debuggability than the ~1 km it would protect.
    expect(redactTilePathPatterns("took 1.23, 4.56 seconds")).toBe(
      "took 1.23, 4.56 seconds",
    );
    expect(redactTilePathPatterns("v2.1, build 7")).toBe("v2.1, build 7");
  });

  it("handles non-Error throwables", () => {
    expect(safeErrorForLog("just a string").name).toBe("NonError");
    expect(safeErrorForLog("just a string").message).toBe("just a string");
  });
});

// PRIV-109: the query string carries user search terms (?search= is matched
// against place NAMES in GET /trips), and no redact path can reach inside a
// URL string.
describe("serializeRequestForLog", () => {
  it("logs the path without the query string", () => {
    const out = serializeRequestForLog({
      id: "req-1",
      method: "GET",
      url: "/trips?search=Claustral&limit=20",
    });
    expect(out.url).toBe("/trips");
    expect(JSON.stringify(out)).not.toContain("Claustral");
  });

  it("keeps a query-free path intact and never emits a body", () => {
    const out = serializeRequestForLog({ id: "req-2", method: "POST", url: "/places" });
    expect(out.url).toBe("/places");
    expect(out).not.toHaveProperty("body");
  });
});

// The api/CLAUDE.md rule "never log a raw thrown error; scrub it with
// safeErrorForLog" was a comment until this test: 21 sites had drifted past it
// by the 2026-08-28 review (APIC-001). Pino's redact.paths only censor
// structured keys — they cannot reach free text inside err.message/err.stack,
// where Prisma renders user-supplied place names and coordinates.
describe("no raw err reaches a log site", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
      return [full];
    });
  }

  it("every logger.* call scrubs its error argument", () => {
    // An `err` key in a logger call's object argument whose value is not a
    // safeErrorForLog(...) call (shorthand `{ err }` included).
    const rawErrLogSite =
      /logger\.\w+\(\s*\{[^}]*?[{,]\s*err\s*(?::(?!\s*safeErrorForLog\()|[,}])/g;
    const offenders = sourceFiles(join(__dirname, "..")).flatMap((file) =>
      (readFileSync(file, "utf8").match(rawErrLogSite) ?? []).map(
        (hit) => `${file}: ${hit.replace(/\s+/g, " ")}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});

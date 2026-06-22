import { describe, it, expect } from "vitest";
import pino from "pino";
import { redactPaths, redactTilePathPatterns, safeErrorForLog } from "./logger";

// Build a pino logger using the SAME redact paths the app logger uses, but
// writing to an in-memory buffer so we can assert what actually gets censored.
// This guards the CLAUDE.md privacy rule: canyon coords/names must never reach
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
  it("censors canyon coordinates and name in a request body", () => {
    const out = captureLog({
      req: { body: { latitude: -33.5, longitude: 150.3, name: "Secret Canyon", notes: "beta" } },
    });
    const body = (out.req as { body: Record<string, unknown> }).body;
    expect(body.latitude).toBe("[redacted]");
    expect(body.longitude).toBe("[redacted]");
    expect(body.name).toBe("[redacted]");
    expect(body.notes).toBe("[redacted]");
  });

  it("censors nested canyon coordinates via wildcard paths", () => {
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
    const out = captureLog({ req: { body: { id: "canyon-1" } } });
    const body = (out.req as { body: Record<string, unknown> }).body;
    expect(body.id).toBe("canyon-1");
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
// inside err.message/err.stack, and Prisma renders user-supplied canyon
// name/coords into a validation error's message. safeErrorForLog must drop the
// rendered argument block before it can reach logs.
describe("safeErrorForLog", () => {
  it("strips a Prisma rendered-args block carrying canyon name/coords", () => {
    const err = new Error(
      "Invalid `prisma.canyon.createMany()` invocation\n\n" +
        "Argument `notes`: Invalid value provided. Expected String or Null, provided Int.\n" +
        '{ name: "Secret Slot Canyon", latitude: -33.7, longitude: 150.3, notes: 12345 }',
    );
    err.name = "PrismaClientValidationError";
    const safe = safeErrorForLog(err);
    expect(safe.name).toBe("PrismaClientValidationError");
    expect(safe.message).not.toMatch(/Secret Slot Canyon/);
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

  it("handles non-Error throwables", () => {
    expect(safeErrorForLog("just a string").name).toBe("NonError");
    expect(safeErrorForLog("just a string").message).toBe("just a string");
  });
});

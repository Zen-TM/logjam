import { describe, it, expect } from "vitest";
import pino from "pino";
import { redactPaths } from "./logger";

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

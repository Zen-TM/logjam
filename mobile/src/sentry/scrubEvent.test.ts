import { describe, it, expect } from "vitest";
import {
  redactTilePathPatterns,
  stripArgsBlock,
  scrubMessage,
  scrubStructure,
  scrubEvent,
  scrubBreadcrumb,
} from "./scrubEvent";

describe("redactTilePathPatterns", () => {
  it("strips URLs", () => {
    expect(redactTilePathPatterns("failed to fetch https://example.com/tiles/12/2456/1578.png now")).toBe(
      "failed to fetch [redacted-url] now",
    );
  });

  it("strips bare z/x/y tile triples", () => {
    expect(redactTilePathPatterns("tile 12/2456/1578 missing")).toBe(
      "tile [redacted-tile] missing",
    );
  });

  it("leaves ordinary text alone", () => {
    expect(redactTilePathPatterns("plain error message")).toBe("plain error message");
  });
});

describe("stripArgsBlock", () => {
  it("drops a rendered args block", () => {
    const msg = "Invalid invocation\n\n{ name: 'Secret Canyon', latitude: -33.7 }";
    expect(stripArgsBlock(msg)).toBe("Invalid invocation\n[redacted-args]");
  });

  it("keeps a message with no args block", () => {
    expect(stripArgsBlock("simple failure")).toBe("simple failure");
  });
});

describe("scrubStructure", () => {
  it("censors coordinate and name keys at any depth", () => {
    const input = {
      canyon: { name: "Secret", latitude: -33.7, longitude: 150.3, safe: "ok" },
      list: [{ notes: "private", other: 1 }],
    };
    expect(scrubStructure(input)).toEqual({
      canyon: { name: "[redacted]", latitude: "[redacted]", longitude: "[redacted]", safe: "ok" },
      list: [{ notes: "[redacted]", other: 1 }],
    });
  });

  it("scrubs URLs inside string values", () => {
    expect(scrubStructure({ url: "https://api.logjamnsw.com/canyons/abc" })).toEqual({
      url: "[redacted-url]",
    });
  });

  it("is case-insensitive on keys", () => {
    expect(scrubStructure({ Name: "x", LATITUDE: 1 })).toEqual({
      Name: "[redacted]",
      LATITUDE: "[redacted]",
    });
  });

  it("caps recursion depth", () => {
    type Nested = { child?: Nested };
    const deep: Nested = {};
    let cursor = deep;
    for (let i = 0; i < 20; i++) {
      cursor.child = {};
      cursor = cursor.child;
    }
    // Must not throw; deep tail is truncated
    expect(JSON.stringify(scrubStructure(deep))).toContain("[redacted-depth]");
  });
});

describe("scrubEvent", () => {
  it("scrubs message, exception values, and drops request + user", () => {
    const event = {
      message: "fetch https://cdn.example.com/master/hydro/12/24/13.pbf failed",
      exception: {
        values: [
          { type: "Error", value: "Invalid input\n{ name: 'Hidden Canyon' }" },
        ],
      },
      request: { url: "https://api.logjamnsw.com/canyons" },
      user: { id: "abc" },
      extra: { latitude: -33.7, harmless: true },
    };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.message).toBe("fetch [redacted-url] failed");
    expect(scrubbed.exception!.values![0].value).toBe("Invalid input\n[redacted-args]");
    expect(scrubbed).not.toHaveProperty("request");
    expect(scrubbed).not.toHaveProperty("user");
    expect(scrubbed.extra).toEqual({ latitude: "[redacted]", harmless: true });
  });

  it("scrubs breadcrumbs attached to an event", () => {
    const event = {
      breadcrumbs: [
        {
          category: "fetch",
          message: "GET https://api.logjamnsw.com/canyons/xyz 200",
          data: { url: "https://api.logjamnsw.com/canyons/xyz", status_code: 200 },
        },
      ],
    };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.breadcrumbs![0].message).toBe("GET [redacted-url] 200");
    expect(scrubbed.breadcrumbs![0].data).toEqual({
      url: "[redacted-url]",
      status_code: 200,
    });
  });

  it("passes through an event with none of the scrubbable fields", () => {
    const event = { message: undefined };
    expect(scrubEvent(event)).toEqual({ message: undefined });
  });
});

describe("scrubBreadcrumb", () => {
  it("scrubs message and data", () => {
    const crumb = {
      category: "xhr",
      message: "tile 14/9821/6032 load",
      data: { name: "Secret Canyon" },
    };
    const scrubbed = scrubBreadcrumb(crumb);
    expect(scrubbed.message).toBe("tile [redacted-tile] load");
    expect(scrubbed.data).toEqual({ name: "[redacted]" });
  });
});

describe("scrubMessage", () => {
  it("applies both args-block and URL/tile redaction", () => {
    const msg = "failed https://x.test/a/1/2/3\n{ latitude: -33 }";
    expect(scrubMessage(msg)).toBe("failed [redacted-url]\n[redacted-args]");
  });
});

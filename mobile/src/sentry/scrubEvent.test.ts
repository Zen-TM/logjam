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

  // The consent sheet promises reports are "scrubbed of canyon names and
  // coordinates". Keyed redaction can only reach a coordinate that is still a
  // field; once it has been interpolated into a message (or a console line,
  // which Sentry captures as a breadcrumb through this same filter) this
  // pattern is the whole promise.
  it("strips a plain-text lat/lng pair", () => {
    expect(redactTilePathPatterns("no fix near -33.5621, 150.4017 yet")).toBe(
      "no fix near [redacted-coords] yet",
    );
  });

  it("strips a bracketed lng/lat pair with no space", () => {
    expect(redactTilePathPatterns("bbox [150.40171,-33.56213] empty")).toBe(
      "bbox [[redacted-coords]] empty",
    );
  });

  it("leaves low-precision number pairs alone", () => {
    // ~1 km at three decimals, and the false-positive cost on timings/ratios
    // is what buys the four-decimal floor.
    expect(redactTilePathPatterns("took 1.25, 3.75 s")).toBe("took 1.25, 3.75 s");
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

  it("scrubs exception stack frames", () => {
    const event = {
      exception: {
        values: [
          {
            type: "Error",
            value: "boom",
            stacktrace: {
              frames: [
                {
                  filename: "http://10.0.2.2:8081/index.bundle?platform=android",
                  function: "recordFix",
                  context_line: "log(`fix at -33.56213, 150.40171`)",
                  vars: { name: "Hidden Canyon", latitude: -33.7, count: 2 },
                },
              ],
            },
          },
        ],
      },
    };
    const frame = scrubEvent(event).exception!.values![0].stacktrace!.frames![0];
    expect(frame.filename).toBe("[redacted-url]");
    expect(frame.function).toBe("recordFix");
    expect(frame.context_line).toBe("log(`fix at [redacted-coords]`)");
    expect(frame.vars).toEqual({
      name: "[redacted]",
      latitude: "[redacted]",
      count: 2,
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

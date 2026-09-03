import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  parseAccessLog,
  parseAccessLogLine,
  isBillableEgress,
  attributeKey,
} from "./s3AccessLog";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "__fixtures__/s3-access-log-sample.log");

// Repo convention: parse the source's REAL output shape, not a tidied version.
// This fixture carries the things a hand-written sample would omit and that
// would each break a naive parser: a bracketed timestamp with an inner space, a
// quoted request URI containing spaces AND percent-encoded quotes, "-" nulls in
// the error-code and turn-around-time columns, a 206 range response, a 403 that
// still reports non-zero bytes_sent, and three different IAM requester shapes.
const LOG = readFileSync(FIXTURE, "utf8");

/** How the sweeper recognises "the API signed this URL" (see egressMeter.ts). */
const API_REQUESTER = "logjam-eb-role";

describe("parseAccessLogLine", () => {
  const records = parseAccessLog(LOG);

  it("reads every record in the fixture", () => {
    expect(records).toHaveLength(10);
  });

  it("puts each field in the right column", () => {
    // The whole meter is positional parsing, so an off-by-one here would
    // silently charge the wrong number from the wrong column — this asserts
    // the exact indices against a real line.
    const first = records[0];
    expect(first.bucket).toBe("logjam-media");
    expect(first.operation).toBe("REST.GET.OBJECT");
    expect(first.key).toBe(
      "media/8f14e45f-ceea-467a-9f0b-1c2d3e4f5a6b/2b7c1d09-4e3a-4b5c-8d6e-7f8091a2b3c4/display.jpg",
    );
    expect(first.httpStatus).toBe(200);
    expect(first.bytesSent).toBe(2841577);
    expect(first.requester).toContain("logjam-eb-role");
  });

  it("does not let the quoted request URI shift later columns", () => {
    // The GeoPDF line's request URI contains both spaces and %22 quotes.
    const geoPdf = records.find((r) => r.key.startsWith("exports/geo-pdf/"));
    expect(geoPdf).toBeDefined();
    expect(geoPdf!.httpStatus).toBe(200);
    expect(geoPdf!.bytesSent).toBe(9846213);
  });

  it("reads '-' as absent rather than as a value", () => {
    // The PUT line has bytes_sent 0 and a '-' turn-around time.
    const put = records.find((r) => r.operation === "REST.PUT.OBJECT");
    expect(put!.bytesSent).toBe(0);
  });

  it("ignores blank lines and truncated records", () => {
    expect(parseAccessLogLine("")).toBeNull();
    expect(parseAccessLogLine("   ")).toBeNull();
    expect(parseAccessLogLine("owner bucket [01/Jan/2026:00:00:00 +0000]")).toBeNull();
  });
});

describe("isBillableEgress", () => {
  const records = parseAccessLog(LOG);
  const billable = records.filter((r) => isBillableEgress(r, API_REQUESTER));

  it("charges presigned user downloads", () => {
    const keys = billable.map((r) => r.key);
    expect(keys).toContain(
      "media/8f14e45f-ceea-467a-9f0b-1c2d3e4f5a6b/2b7c1d09-4e3a-4b5c-8d6e-7f8091a2b3c4/display.jpg",
    );
    expect(keys).toContain(
      "exports/c9bf9e57-1685-4c89-bafb-ff5af830be8a/logjam-export.mbtiles",
    );
  });

  it("does NOT charge the worker's own same-region reads", () => {
    // The single most important exclusion: a topo worker pulling a 4 GB input
    // ZIP is free to us, and billing it would exhaust a user's whole monthly
    // allowance on their first job.
    const workerRead = records.find((r) => r.key.endsWith("upload.zip"))!;
    expect(workerRead.bytesSent).toBe(4294967296);
    expect(isBillableEgress(workerRead, API_REQUESTER)).toBe(false);
  });

  it("does NOT charge CloudFront's basemap reads", () => {
    const cdn = records.find((r) => r.key.startsWith("master/"))!;
    expect(isBillableEgress(cdn, API_REQUESTER)).toBe(false);
  });

  it("does NOT charge uploads", () => {
    const put = records.find((r) => r.operation === "REST.PUT.OBJECT")!;
    expect(isBillableEgress(put, API_REQUESTER)).toBe(false);
  });

  it("does NOT charge an error response that still reported bytes", () => {
    // The 403 line carries bytes_sent 243 (the error XML). Charging on status
    // alone would let a loop of denied requests drain an allowance.
    const denied = records.find((r) => r.httpStatus === 403)!;
    expect(denied.bytesSent).toBeGreaterThan(0);
    expect(isBillableEgress(denied, API_REQUESTER)).toBe(false);
  });

  it("DOES charge a 206 range response", () => {
    // Range requests move real bytes; a naive `status === 200` check would let
    // a ranged download loop egress for free.
    const partial = records.find((r) => r.httpStatus === 206)!;
    expect(isBillableEgress(partial, API_REQUESTER)).toBe(true);
    expect(partial.bytesSent).toBe(1048576);
  });

  it("charges nothing when the requester pattern is empty", () => {
    // Fail closed: a misconfigured pattern must under-count, never match
    // everything and bill users for the workers' reads.
    for (const record of records) {
      expect(isBillableEgress(record, "")).toBe(false);
    }
  });

  it("sums to only the user-attributable bytes in the fixture", () => {
    const total = billable.reduce((sum, r) => sum + r.bytesSent, 0);
    // 2841577 + 18442 + 44219 + 187433216 + 9846213 + 1048576
    expect(total).toBe(201232243);
  });
});

describe("attributeKey", () => {
  it("reads the owner straight out of a media key", () => {
    expect(attributeKey("media/user-1/m1/display.jpg")).toEqual({
      kind: "user",
      userId: "user-1",
    });
  });

  it("charges a file send to the SENDER, not the downloading recipient", () => {
    // Otherwise anyone could drain a stranger's allowance by repeatedly
    // downloading what that stranger sent them.
    expect(attributeKey("file-sends/sender-1/s1/track.gpx")).toEqual({
      kind: "user",
      userId: "sender-1",
    });
  });

  it("routes topo job prefixes to the topo job table", () => {
    for (const prefix of ["inputs", "outputs", "jobs"]) {
      expect(attributeKey(`${prefix}/job-1/file.bin`)).toEqual({
        kind: "job",
        table: "topoJob",
        jobId: "job-1",
      });
    }
  });

  it("distinguishes exports/geo-pdf/<id> from exports/<id>", () => {
    // These two share a prefix. Testing the generic form first would read the
    // literal "geo-pdf" as an export job id, and every GeoPDF download would
    // go unattributed — free egress, silently.
    expect(attributeKey("exports/geo-pdf/pdf-1/logjam-export.pdf")).toEqual({
      kind: "job",
      table: "geoPdfJob",
      jobId: "pdf-1",
    });
    expect(attributeKey("exports/exp-1/out.mbtiles")).toEqual({
      kind: "job",
      table: "topoExportJob",
      jobId: "exp-1",
    });
  });

  it("attributes shared basemap tiles to nobody", () => {
    expect(attributeKey("master/hillshade/12/3771/2461.pbf")).toBeNull();
  });

  it("returns null for unknown or malformed keys rather than guessing", () => {
    expect(attributeKey("something-new/a/b")).toBeNull();
    expect(attributeKey("toplevel.txt")).toBeNull();
    expect(attributeKey("media/")).toBeNull();
  });
});

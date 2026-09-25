/**
 * Parser for the S3 server access log format, plus the rules for deciding
 * which log records represent egress a USER should be charged for.
 *
 * Pure functions, no AWS: lib/egressMeter.ts does the S3 reads and DB writes.
 *
 * The format is space-separated with two quoting conventions — [bracketed
 * timestamps] and "quoted strings" — and uses "-" for absent values. Fields are
 * positional and AWS only ever appends new ones, so parsing by index is stable.
 * https://docs.aws.amazon.com/AmazonS3/latest/userguide/LogFormat.html
 */

/**
 * Field indices we actually read, after splitFields collapses the bracketed
 * timestamp and each quoted string into a single field:
 *
 *   0 bucket owner   1 bucket        2 [time]        3 remote IP
 *   4 requester      5 request id    6 operation     7 key
 *   8 "request URI"  9 HTTP status  10 error code   11 bytes sent
 *  12 object size   13 total time   …
 */
const FIELD = {
  BUCKET_OWNER: 0,
  BUCKET: 1,
  REQUESTER: 4,
  OPERATION: 6,
  KEY: 7,
  HTTP_STATUS: 9,
  BYTES_SENT: 11,
} as const;

export type AccessLogRecord = {
  bucket: string;
  requester: string;
  operation: string;
  key: string;
  httpStatus: number;
  bytesSent: number;
};

/**
 * Split one log line into raw fields, honouring [..] and ".." grouping.
 *
 * Hand-rolled rather than a regex: the quoted request line legitimately
 * contains spaces AND the key can contain URL-encoded quotes, and a
 * single-regex version of that is the kind of thing nobody can debug later.
 */
function splitFields(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let closer: string | null = null;

  for (const char of line) {
    if (closer !== null) {
      if (char === closer) {
        closer = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "[") {
      closer = "]";
      continue;
    }
    if (char === '"') {
      closer = '"';
      continue;
    }
    if (char === " ") {
      if (current !== "") fields.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current !== "") fields.push(current);
  return fields;
}

/** "-" is the format's null. */
function orNull(value: string | undefined): string | null {
  return value === undefined || value === "-" ? null : value;
}

function toNumber(value: string | undefined): number {
  const raw = orNull(value);
  if (raw === null) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Parse one line, or null if it is blank or too short to be a real record. */
export function parseAccessLogLine(line: string): AccessLogRecord | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;

  const fields = splitFields(trimmed);
  if (fields.length <= FIELD.BYTES_SENT) return null;

  const bucket = orNull(fields[FIELD.BUCKET]);
  const key = orNull(fields[FIELD.KEY]);
  const operation = orNull(fields[FIELD.OPERATION]);
  if (bucket === null || key === null || operation === null) return null;

  return {
    bucket,
    requester: orNull(fields[FIELD.REQUESTER]) ?? "",
    operation,
    key,
    httpStatus: toNumber(fields[FIELD.HTTP_STATUS]),
    bytesSent: toNumber(fields[FIELD.BYTES_SENT]),
  };
}

export function parseAccessLog(contents: string): AccessLogRecord[] {
  const records: AccessLogRecord[] = [];
  for (const line of contents.split("\n")) {
    const record = parseAccessLogLine(line);
    if (record !== null) records.push(record);
  }
  return records;
}

/**
 * Does this record represent internet egress that a user is responsible for?
 *
 * The distinction that makes the whole meter work: the same bucket serves
 * user downloads AND the workers' own reads, and only the first costs egress.
 * A worker pulling 20 GB of LiDAR input from S3 to a Fargate task in the same
 * region is free, and billing a user for it would exhaust their allowance on
 * their first topo job.
 *
 * `requester` is the IAM principal, which separates them cleanly:
 *   - the API's EB instance role  → it signed a presigned URL for a browser or
 *     phone. This is the one we charge.
 *   - the topo worker role        → same-region task read. Free.
 *   - a CloudFront service principal → the shared basemap under master/*, not
 *     attributable to any user, and covered by the account budget instead.
 *
 * Anything we cannot attribute is deliberately NOT charged. Under-counting is
 * the correct failure direction for a limit that refuses service.
 */
export function isBillableEgress(
  record: AccessLogRecord,
  apiRequesterPattern: string,
): boolean {
  // GET only. PUTs are uploads (ingress, free) and are already bounded by the
  // storage quota; HEAD/LIST move no meaningful bytes.
  if (record.operation !== "REST.GET.OBJECT") return false;
  // 2xx only. A 304, 403 or 404 sent no object body; range requests are 206 and
  // DO send bytes, so the range must include 206.
  if (record.httpStatus < 200 || record.httpStatus >= 300) return false;
  if (record.bytesSent <= 0) return false;
  if (apiRequesterPattern === "") return false;
  return record.requester.includes(apiRequesterPattern);
}

/**
 * The user responsible for an object, derived from its key prefix, or null when
 * the object is not attributable to one.
 *
 *   media/<userId>/<mediaId>/…        → that user
 *   file-sends/<senderId>/…           → the SENDER, not the recipient who
 *                                       downloads it. The sender chose to send
 *                                       it; charging the recipient would let
 *                                       anyone drain a stranger's allowance.
 *   inputs|outputs|jobs/<topoJobId>/… → looked up via the job tables
 *   exports/geo-pdf/<geoPdfJobId>/…   → ditto (checked before `exports/`, whose
 *                                       prefix it shares)
 *   exports/<exportJobId>/…           → ditto
 *   master/…                          → shared basemap, nobody's egress
 *
 * Returns either a direct user id or a job reference for the caller to resolve;
 * this function stays pure and does no database work.
 */
export type KeyAttribution =
  | { kind: "user"; userId: string }
  | { kind: "job"; table: "topoJob" | "topoExportJob" | "geoPdfJob"; jobId: string };

export function attributeKey(key: string): KeyAttribution | null {
  const segments = key.split("/");
  if (segments.length < 2) return null;
  const [head, second, third] = segments;

  switch (head) {
    case "media":
    case "file-sends":
      return second ? { kind: "user", userId: second } : null;
    case "inputs":
    case "outputs":
    case "jobs":
      return second ? { kind: "job", table: "topoJob", jobId: second } : null;
    case "exports":
      // "exports/geo-pdf/<id>/…" must be tested before the generic form —
      // otherwise the literal "geo-pdf" is read as an export job id and every
      // GeoPDF download is silently unattributed.
      if (second === "geo-pdf") {
        return third ? { kind: "job", table: "geoPdfJob", jobId: third } : null;
      }
      return second ? { kind: "job", table: "topoExportJob", jobId: second } : null;
    default:
      // master/* (shared basemap tiles) and anything new we have not taught
      // this function about.
      return null;
  }
}

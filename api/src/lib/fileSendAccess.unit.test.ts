import { describe, it, expect } from "vitest";

import { AppError } from "../middleware/errorHandler";
import {
  assertSendableSize,
  canRecipientDownload,
  fileSendExpiresAt,
  fileSendKey,
  sanitizeSendFilename,
  sendableExtension,
} from "./fileSendAccess";
import { FILE_SEND_MAX_BYTES, FILE_SEND_TTL_DAYS } from "@logjam/shared";

const NOW = new Date("2026-08-22T12:00:00Z");

function statusOf(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (error) {
    return (error as AppError).statusCode;
  }
  return undefined;
}

// The filename is the ONE user-supplied string on a send, and it reaches a
// presigned URL's Content-Disposition. These tests are the reason it is a
// function rather than an inline `.trim()`.
describe("sanitizeSendFilename", () => {
  it("keeps an ordinary filename intact", () => {
    expect(sanitizeSendFilename("Kanangra Main.gpx")).toBe("Kanangra Main.gpx");
  });

  it("strips the quote that would close the Content-Disposition token", () => {
    expect(sanitizeSendFilename('eve"il.gpx')).toBe("eveil.gpx");
    expect(sanitizeSendFilename("back\\slash.gpx")).toBe("backslash.gpx");
  });

  it("strips CR/LF and other control characters", () => {
    expect(sanitizeSendFilename("a\r\nb.gpx")).toBe("ab.gpx");
    expect(sanitizeSendFilename("a\x00\x1f\x7fb.kml")).toBe("ab.kml");
  });

  it("rejects a non-string, an empty name, and one that is only junk", () => {
    expect(statusOf(() => sanitizeSendFilename(undefined))).toBe(400);
    expect(statusOf(() => sanitizeSendFilename(42))).toBe(400);
    expect(statusOf(() => sanitizeSendFilename("   "))).toBe(400);
    expect(statusOf(() => sanitizeSendFilename('"""'))).toBe(400);
  });

  it("rejects an over-long filename", () => {
    expect(statusOf(() => sanitizeSendFilename("a".repeat(256) + ".gpx"))).toBe(
      400,
    );
    expect(sanitizeSendFilename("a".repeat(251) + ".gpx")).toHaveLength(255);
  });
});

// The extension becomes part of an S3 key, so the whitelist is what stops user
// text reaching an object path.
describe("sendableExtension", () => {
  it("accepts the three formats the import path accepts", () => {
    expect(sendableExtension("a.gpx")).toBe("gpx");
    expect(sendableExtension("a.KML")).toBe("kml");
    expect(sendableExtension("a.geojson")).toBe("geojson");
  });

  it("rejects anything else, including a path-traversal attempt", () => {
    expect(statusOf(() => sendableExtension("a.exe"))).toBe(400);
    expect(statusOf(() => sendableExtension("noextension"))).toBe(400);
    expect(statusOf(() => sendableExtension("../../etc/passwd"))).toBe(400);
  });
});

describe("fileSendKey", () => {
  it("derives entirely from server-side values under the lifecycle prefix", () => {
    expect(fileSendKey("sender-1", "send-1", "gpx")).toBe(
      "file-sends/sender-1/send-1/copy.gpx",
    );
  });

  // The S3 lifecycle rule is scoped to `file-sends/`; a key outside it would
  // never expire and the quota refund would be for bytes that still exist.
  it("always sits under the file-sends/ prefix", () => {
    expect(fileSendKey("s", "i", "kml").startsWith("file-sends/")).toBe(true);
  });
});

describe("assertSendableSize", () => {
  it("accepts a positive integer inside the cap", () => {
    expect(assertSendableSize(1024)).toBe(1024);
  });

  it("rejects non-integers, zero and negatives with 400", () => {
    expect(statusOf(() => assertSendableSize("1024"))).toBe(400);
    expect(statusOf(() => assertSendableSize(1.5))).toBe(400);
    expect(statusOf(() => assertSendableSize(0))).toBe(400);
    expect(statusOf(() => assertSendableSize(-1))).toBe(400);
  });

  // Derived from the constant, never a literal: this cap has already moved once
  // (30 MB → 64 MB, when GeoPDFs became sendable) and a hardcoded copy here is
  // a second list that has to agree with the first.
  it("rejects an oversized file with 413 and accepts one exactly at the cap", () => {
    expect(statusOf(() => assertSendableSize(FILE_SEND_MAX_BYTES + 1))).toBe(413);
    expect(assertSendableSize(FILE_SEND_MAX_BYTES)).toBe(FILE_SEND_MAX_BYTES);
  });
});

describe("fileSendExpiresAt", () => {
  it("is exactly FILE_SEND_TTL_DAYS ahead", () => {
    expect(fileSendExpiresAt(NOW).getTime() - NOW.getTime()).toBe(
      FILE_SEND_TTL_DAYS * 86_400_000,
    );
  });
});

// The central invariant of the whole feature. One S3 object serves every
// recipient of a send, so eligibility MUST be a fact about the person — never
// about whether the bytes exist.
describe("canRecipientDownload", () => {
  const send = { expiresAt: new Date("2026-08-29T12:00:00Z") };

  it("lets a pending recipient download", () => {
    expect(canRecipientDownload({ status: "pending" }, send, NOW)).toBe(true);
  });

  it("lets an accepted recipient download again — they already have it", () => {
    expect(canRecipientDownload({ status: "accepted" }, send, NOW)).toBe(true);
  });

  it("refuses a declined recipient", () => {
    expect(canRecipientDownload({ status: "declined" }, send, NOW)).toBe(false);
  });

  // The bug this design exists to avoid: one person declining (or accepting)
  // must not affect anyone else on the same send, because they share an object.
  it("decides per recipient — a decline does not touch a sibling", () => {
    const declined = canRecipientDownload({ status: "declined" }, send, NOW);
    const sibling = canRecipientDownload({ status: "pending" }, send, NOW);
    expect(declined).toBe(false);
    expect(sibling).toBe(true);
  });

  it("refuses everyone once the send has expired", () => {
    const expired = { expiresAt: new Date("2026-08-01T12:00:00Z") };
    expect(canRecipientDownload({ status: "pending" }, expired, NOW)).toBe(false);
    expect(canRecipientDownload({ status: "accepted" }, expired, NOW)).toBe(
      false,
    );
  });
});

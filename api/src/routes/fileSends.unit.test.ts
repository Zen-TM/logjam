import { describe, it, expect } from "vitest";

import { recipientRowWhere } from "./fileSends";
import { inboxWhere, isMissingObjectError } from "../lib/fileSendAccess";

const ME = "user-me";
const STRANGER_SEND = "send-not-mine";
const NOW = new Date("2026-08-22T12:00:00Z");

// The access boundary of the send surface, in the shape the repo tests these:
// the pure filter, not a mounted Express app. What these defend is that a user
// can only ever reach their OWN recipient row — a send addressed to somebody
// else must be indistinguishable from one that does not exist.
describe("recipientRowWhere — the accept/decline gate", () => {
  it("keys on the caller AND the send, never the send alone", () => {
    expect(recipientRowWhere(ME, STRANGER_SEND)).toEqual({
      userId: ME,
      fileSendId: STRANGER_SEND,
    });
  });

  // The failure this exists to prevent: dropping `userId` would let anyone
  // holding a send id accept a stranger's file. The lookup misses, the route
  // 404s, and a non-recipient learns nothing about whether the id is real.
  it("always carries userId", () => {
    expect(recipientRowWhere(ME, "any-id")).toHaveProperty("userId", ME);
  });

  it("is not symmetric — the caller is never taken from the id", () => {
    expect(recipientRowWhere(ME, "send-1")).not.toEqual(
      recipientRowWhere("user-other", "send-1"),
    );
  });
});

describe("inboxWhere", () => {
  it("scopes to the caller, hides declined, and excludes expired sends", () => {
    expect(inboxWhere(ME, NOW)).toEqual({
      userId: ME,
      status: { not: "declined" },
      fileSend: { expiresAt: { gt: NOW } },
    });
  });

  // The sweep is periodic, so a row can outlive its bytes by up to one
  // interval. Filtering on expiry here means the inbox never offers a file the
  // download gate would then refuse.
  it("filters expiry in the query rather than trusting the sweep", () => {
    expect(inboxWhere(ME, NOW).fileSend).toEqual({ expiresAt: { gt: NOW } });
  });
});

// Whether a missing object retires a send or is retried is the difference
// between "the offer is withdrawn" and "a user permanently loses a file to a
// throttle", so the branch gets its own test.
describe("isMissingObjectError", () => {
  it("treats a definitively absent object as gone", () => {
    expect(isMissingObjectError({ $metadata: { httpStatusCode: 404 } })).toBe(true);
    expect(isMissingObjectError({ name: "NotFound" })).toBe(true);
    expect(isMissingObjectError({ name: "NoSuchKey" })).toBe(true);
  });

  it("leaves a fault retryable rather than retiring the send", () => {
    expect(isMissingObjectError({ $metadata: { httpStatusCode: 503 } })).toBe(false);
    expect(isMissingObjectError({ name: "ThrottlingException" })).toBe(false);
    expect(isMissingObjectError({ name: "AccessDenied" })).toBe(false);
    expect(isMissingObjectError(new Error("socket hang up"))).toBe(false);
    expect(isMissingObjectError(null)).toBe(false);
    expect(isMissingObjectError(undefined)).toBe(false);
  });
});

import { createHash, randomBytes } from "node:crypto";

/** 256 random bits: the token is the whole credential, so it is unguessable. */
export function mintFriendInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * What the database keeps. Only the hash is stored, so a read of the table
 * (a backup, a snapshot, a query log) yields no working link. Unsalted is
 * enough: the input is 256 random bits, not a password.
 */
export function hashFriendInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

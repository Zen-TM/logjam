// Local identity — MOBILE_APP_PLAN Stage 1 offline-session semantics.
//
// After the first successful login we persist who is signed in (Cognito sub +
// username) so the app can cold-start into that account's local data with
// zero network. Cognito gates the *API*; the gate on local data is the app
// lock (Stage 4), not a token check. This record outlives token expiry and is
// cleared only on explicit sign-out or when a *different* user signs in
// (which also wipes local data — enforced by the caller in useAuth).
import * as SecureStore from "expo-secure-store";

const IDENTITY_KEY = "logjam_local_identity";

export type LocalIdentity = {
  sub: string;
  username: string;
};

export async function readLocalIdentity(): Promise<LocalIdentity | null> {
  const raw = await SecureStore.getItemAsync(IDENTITY_KEY);
  if (raw == null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as LocalIdentity).sub !== "string" ||
    typeof (parsed as LocalIdentity).username !== "string"
  ) {
    // Fail loudly — a corrupt identity record must not silently pass as
    // "no one signed in" (that path wipes local data on next login).
    throw new Error("Corrupt local identity record");
  }
  return parsed as LocalIdentity;
}

export async function writeLocalIdentity(identity: LocalIdentity): Promise<void> {
  await SecureStore.setItemAsync(IDENTITY_KEY, JSON.stringify(identity));
}

export async function clearLocalIdentity(): Promise<void> {
  await SecureStore.deleteItemAsync(IDENTITY_KEY);
}

/** `readLocalIdentity` as a sign-in reads it: a corrupt record is a distinct
 *  answer, never folded into "nobody". */
export type PreviousIdentity = LocalIdentity | null | "unreadable";

export async function readPreviousIdentity(): Promise<PreviousIdentity> {
  try {
    return await readLocalIdentity();
  } catch (err) {
    console.error(err);
    return "unreadable";
  }
}

/**
 * Must signing in as `sub` wipe the data already on this phone?
 *
 * `null` is nobody — a guest linking an account keeps what they made, by
 * design. An UNREADABLE record cannot prove the data is this account's, so it
 * is treated as someone else's: the wipe costs at most this user's own unsent
 * changes, where keeping it hands a stranger's places to whoever signs in. The
 * sign-in used to `.catch(() => null)` here, which turned a corrupt record into
 * a guest and skipped the wipe entirely.
 */
export function signInNeedsWipe(previous: PreviousIdentity, sub: string): boolean {
  return previous === "unreadable" || (previous !== null && previous.sub !== sub);
}

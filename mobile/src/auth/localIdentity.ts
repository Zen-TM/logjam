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

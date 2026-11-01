// What happens between the browser sheet returning tokens and the app opening
// on them: whose phone is this, and does anything on it have to go first.
// Pulled out of `useAuth` so the order can be tested without a renderer.
import { apiFetch } from "../api/apiFetch";
import { wipeAllLocalData } from "../offline/wipeLocalData";
import { unregisterPushNotifications } from "../notifications/pushRegistration";
import { writeEntryChoice } from "./guestModePreference";
import {
  clearLocalIdentity,
  readPreviousIdentity,
  signInNeedsWipe,
  writeLocalIdentity,
} from "./localIdentity";
import { identityFromIdToken } from "./oidcSession";

export type FinishedSignIn = { ok: true } | { ok: false; error: string };

/**
 * The tokens are NOT stored yet: `signIn.commit()` stores them after the
 * departing user's push binding and data are gone, so the push DELETE runs
 * under the departing session (the API deletes only the caller's own rows) and
 * every `ok: false` leaves the phone as it was, with no half-signed-in state to
 * undo. If the departing session was already rejected there is none to run it
 * under and the unregister fails, which it may: it is best effort, and the
 * server prunes dead tokens (Guard: finishSignIn.test.ts, "unregisters push
 * before the new tokens are stored").
 */
export async function finishSignIn(signIn: {
  idToken: string;
  commit: () => Promise<void>;
}): Promise<FinishedSignIn> {
  const identity = identityFromIdToken(signIn.idToken);
  if (!identity) {
    // No sub, no way to tell whose data is on this phone — and no identity to
    // persist, so the next sign-in would skip this check as well; falling
    // through would sign in blind.
    return {
      ok: false,
      error:
        "Sign-in didn't return an account identity, so it was cancelled. Please try again.",
    };
  }
  const previous = await readPreviousIdentity();
  if (signInNeedsWipe(previous, identity.sub)) {
    // Someone else's places, tracks, photos and downloaded regions must not be
    // visible to — or flushed under the token of — the account now signing in.
    // Everything goes before the new identity lands. A GUEST has `previous ===
    // null` and is untouched: linking keeps the local data, by design. An
    // unreadable record is NOT a guest — see `signInNeedsWipe`.
    //
    // The push binding goes first: without this the device stays bound to the
    // departing account, and re-binding depends entirely on the arriving user
    // granting notifications.
    await unregisterPushNotifications();
    const wiped = await wipeAllLocalData();
    if (wiped.failed.length > 0) {
      // Fail loudly rather than sign in over a half-cleared device: the
      // alternative is silently merging two people's data.
      return {
        ok: false,
        error: `Couldn't clear the previous account's ${wiped.failed.join(" and ")} from this phone, so sign-in was cancelled.`,
      };
    }
    await clearLocalIdentity();
  }
  await writeLocalIdentity(identity);
  await signIn.commit();
  // This install has an account now — never show the entry chooser again.
  writeEntryChoice("account");
  // Await provisioning before opening the app (GET /users/me creates the row;
  // other endpoints 404 until it exists). Best-effort: if the API is
  // unreachable we sign in anyway.
  await apiFetch("/users/me").catch(console.error);
  return { ok: true };
}

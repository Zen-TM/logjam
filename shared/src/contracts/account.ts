// The signed-in account page: Logjam Web's `AccountPanel.tsx` and the dialogs
// it opens, Logjam GPS's `screens/AccountScreen.tsx`. The hero is who you are:
// the page's own answer (shared/DESIGN.md §2).
import type { ScreenContract } from "./types.js";

export const ACCOUNT = {
  id: "account.page",
  question: "Who am I signed in as, and what am I using?",
  sections: [
    { key: "hero" },
    { key: "storage" },
    { key: "credits" },
    { key: "signIn" },
    {
      key: "yourData",
      on: "web",
      reason:
        "Logjam GPS has no data export: a gap, not a choice. The export is built from the account's server data.",
    },
    { key: "leaving" },
    // The version and the Terms.
    { key: "footer" },
  ],
  copy: {
    storage: "Storage",
    storageHint: "photos, videos and LiDAR maps",
    credits: "Processing credits this month",
    creditsHint: "LiDAR maps, exports and GeoPDFs",
    signIn: "Sign-in",
    email: "Email",
    yourData: "Your data",
    leaving: "Leaving",

    changeUsername: "Change username",
    changeEmail: "Change email",
    signOut: "Sign out",
    signOutEverywhere: "Sign out everywhere",
    deleteAccount: "Delete account",

    newEmail: "New email",
    verificationCode: "Verification code",
    sendCode: "Send code",
    confirmEmail: "Confirm email",
  },
} as const satisfies ScreenContract;

/** What deleting an account takes, and what it leaves. */
export const ACCOUNT_DELETE_BODY =
  "Your sign-in, places, trips, notes, photos, maps and shares are deleted. Places other people copied from you stay theirs. This can't be undone.";

/** What signing out everywhere does to the account's other sessions. */
export const SIGN_OUT_EVERYWHERE_NOTE =
  "Every other phone and browser signed in to your account is signed out too.";

/** Logjam Web's confirm: its only loss is the sessions, so it says what stays. */
export const SIGN_OUT_EVERYWHERE_BODY = `${SIGN_OUT_EVERYWHERE_NOTE} Your places and trips stay in your account.`;

/** Shown when the session could not be refreshed first, so nothing was ended. */
export const SIGN_OUT_EVERYWHERE_FAILED =
  "Sign-out everywhere didn't finish, and you're still signed in. Check your connection and try again.";

/** The phrase that proves a deliberate delete: more than a pasted username. */
export function deleteAccountPhrase(username: string): string {
  return `delete ${username}`;
}

export function deleteAccountPhraseLabel(username: string): string {
  return `Type "${deleteAccountPhrase(username)}" to confirm`;
}

export function deleteAccountPhraseMatches(
  typed: string,
  username: string,
): boolean {
  return (
    typed.trim().toLowerCase() === deleteAccountPhrase(username).toLowerCase()
  );
}

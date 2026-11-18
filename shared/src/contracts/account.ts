// The signed-in account page: Logjam Web's `AccountPanel.tsx` and the dialogs
// it opens, Logjam GPS's `screens/AccountScreen.tsx`. The hero is who you are:
// the page's own answer (shared/DESIGN.md §2).
import type { ClientOnly, ScreenContract } from "./types.js";
import { t } from "../i18n.js";

export const ACCOUNT = {
  id: "account.page",
  question: t`Who am I signed in as, and what am I using?`,
  sections: [
    { key: "hero" },
    { key: "storage" },
    { key: "credits" },
    { key: "signIn" },
    {
      key: "yourData",
      on: "web",
      gap: t`Logjam GPS has no data export yet.`,
    },
    { key: "leaving" },
    // Terms · Privacy · Report a bug on both clients (ACCOUNT_FOOTER_LINKS), and
    // on Logjam GPS the installed version, which a bug report quotes.
    { key: "footer" },
  ],
  copy: {
    storage: t`Storage`,
    storageHint: t`photos, videos and LiDAR maps`,
    credits: t`Processing credits this month`,
    creditsHint: t`LiDAR maps and printed or GIS maps`,
    signIn: t`Sign-in`,
    email: t`Email`,
    yourData: t`Your data`,
    leaving: t`Leaving`,

    changeUsername: t`Change username`,
    changeEmail: t`Change email`,
    signOut: t`Sign out`,
    signOutEverywhere: t`Sign out everywhere`,
    deleteAccount: t`Delete account`,

    newEmail: t`New email`,
    verificationCode: t`Verification code`,
    sendCode: t`Send code`,
    confirmEmail: t`Confirm email`,
  },
} as const satisfies ScreenContract;

export const SOURCE_URL = "https://github.com/Zen-TM/logjam";

export const BUG_REPORT_URL = `${SOURCE_URL}/issues/new?template=bug.yml`;

/** The links under the account, in order. Each client supplies where it opens
 *  one; a client's table is typed by the id, so a new link cannot be left out. */
export const ACCOUNT_FOOTER_LINKS = [
  { id: "terms", label: t`Terms` },
  { id: "privacy", label: t`Privacy` },
  { id: "reportBug", label: t`Report a bug` },
] as const;

export type AccountFooterLinkId = (typeof ACCOUNT_FOOTER_LINKS)[number]["id"];

/**
 * What only Logjam GPS does around signing in and out. Neither is a section of
 * the account page: the first is on the landing screen, the second a confirm.
 */
export const ACCOUNT_PHONE_ONLY = [
  {
    id: "guestMode",
    on: "gps",
    reason: t`A phone works in the field with no account, keeping everything on the phone. A browser tab keeps nothing, so Logjam Web always asks for an account.`,
  },
  {
    id: "signOutConfirm",
    on: "gps",
    reason: t`Logjam GPS holds work that is not synced, so signing out says how much would be lost. Logjam Web writes straight to the account, and signing out loses nothing.`,
  },
] as const satisfies readonly ClientOnly[];

/** What deleting an account takes, and what it leaves. */
export const ACCOUNT_DELETE_BODY = t`Your sign-in, places, trips, notes, photos, maps and shares are deleted. Places other people copied from you stay theirs. This can't be undone.`;

/** What signing out everywhere does to the account's other sessions. */
export const SIGN_OUT_EVERYWHERE_NOTE = t`Every other phone and browser signed in to your account is signed out too.`;

/** Logjam Web's confirm: its only loss is the sessions, so it says what stays. */
export const SIGN_OUT_EVERYWHERE_BODY = t`Every other phone and browser signed in to your account is signed out too. Your places and trips stay in your account.`;

/** Shown when the session could not be refreshed first, so nothing was ended. */
export const SIGN_OUT_EVERYWHERE_FAILED = t`Sign-out everywhere didn't finish, and you're still signed in. Check your connection and try again.`;

/** The phrase that proves a deliberate delete: more than a pasted username. */
export function deleteAccountPhrase(username: string): string {
  return `delete ${username}`;
}

export function deleteAccountPhraseLabel(username: string): string {
  return t`Type "${deleteAccountPhrase(username)}" to confirm`;
}

export function deleteAccountPhraseMatches(
  typed: string,
  username: string,
): boolean {
  return (
    typed.trim().toLowerCase() === deleteAccountPhrase(username).toLowerCase()
  );
}

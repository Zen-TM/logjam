// The order Sign out runs in, with its steps passed in so a test can watch the
// order (App.tsx supplies the real ones; mobile/ has no renderer to test it in).
//
// Sign out everywhere (ADR 0041) has two network steps and both come BEFORE
// anything on the phone is touched: the forced refresh, so a stale token cannot
// fail the second, and the provider's GlobalSignOut after the user has
// confirmed. Either failing leaves the phone signed in with its data
// (Guard: signOutSequence.test.ts).
export type SignOutSteps = {
  everywhere: boolean;
  /** The account is already gone: nothing to ask, nothing to end remotely. */
  accountDeleted: boolean;
  assertCanSignOutEverywhere: () => Promise<void>;
  confirm: () => Promise<boolean>;
  signOutEverywhereAtProvider: () => Promise<void>;
  /** Tell the user the other sessions could not be ended. */
  reportEverywhereFailed: (err: unknown) => void;
  /** Needs the session, so it runs before the tokens go. */
  unregisterPush: () => Promise<void>;
  wipe: () => Promise<{ failed: string[] }>;
  reportWipeIncomplete: (failed: string[]) => void;
  /** Clears the tokens and identity and lands on the chooser. */
  finish: () => Promise<void>;
};

export async function runSignOut(steps: SignOutSteps): Promise<void> {
  if (steps.everywhere) {
    try {
      await steps.assertCanSignOutEverywhere();
    } catch (err) {
      steps.reportEverywhereFailed(err);
      return;
    }
  }
  if (!steps.accountDeleted && !(await steps.confirm())) return;
  if (steps.everywhere) {
    try {
      await steps.signOutEverywhereAtProvider();
    } catch (err) {
      steps.reportEverywhereFailed(err);
      return;
    }
  }
  await steps.unregisterPush();
  const wiped = await steps.wipe();
  if (wiped.failed.length > 0) steps.reportWipeIncomplete(wiped.failed);
  await steps.finish();
}

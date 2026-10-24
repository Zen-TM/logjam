import { fetchAuthSession, signOut } from "aws-amplify/auth";

import { config } from "../config";

export async function cognitoSignOut(
  options: { everywhere?: boolean } = {},
): Promise<void> {
  // Fake auth never configures Amplify (amplifyConfig.ts), so its signOut
  // raises NoAmplifyContextError. There is no Cognito session to end.
  if (config.authMode === "fake") return;
  await signOut({ global: options.everywhere === true });
}

/**
 * Amplify's global sign-out swallows a failed GlobalSignOut and still clears
 * this phone, so an expired access token or no reception would look like
 * success while every other session lived on. Refreshing first makes that
 * failure throw here, before anything on the phone is wiped.
 */
export async function assertCanSignOutEverywhere(): Promise<void> {
  if (config.authMode === "fake") return;
  const { tokens } = await fetchAuthSession({ forceRefresh: true });
  if (!tokens) throw new Error("No session to refresh");
}

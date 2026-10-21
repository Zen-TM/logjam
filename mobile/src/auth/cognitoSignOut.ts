import { signOut } from "aws-amplify/auth";

import { config } from "../config";

export async function cognitoSignOut(): Promise<void> {
  // Fake auth never configures Amplify (amplifyConfig.ts), so its signOut
  // raises NoAmplifyContextError. There is no Cognito session to end.
  if (config.authMode === "fake") return;
  await signOut();
}

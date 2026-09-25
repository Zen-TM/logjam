// Amplify/Cognito wiring — same pool as web (frontend/src/main.tsx is the
// reference). Called once at app startup from index.ts. In fake-auth dev mode
// Amplify is never configured — apiFetch short-circuits to a fake token.
import { Amplify } from "aws-amplify";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";

import { config } from "../config";
import { secureKeyValueStorage } from "./secureKeyValueStorage";

export function configureAmplify(): void {
  if (config.authMode === "fake") return;
  const { cognitoUserPoolId, cognitoClientId } = config;
  if (!cognitoUserPoolId || !cognitoClientId) {
    // Fail loudly — a real-auth build without pool config would otherwise
    // surface as opaque sign-in failures.
    throw new Error(
      "EXPO_PUBLIC_COGNITO_USER_POOL_ID and EXPO_PUBLIC_COGNITO_CLIENT_ID are required when EXPO_PUBLIC_AUTH_MODE is not 'fake'",
    );
  }
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: cognitoUserPoolId,
        userPoolClientId: cognitoClientId,
      },
    },
  });
  // Tokens go to Keychain/Keystore via the chunked SecureStore adapter — never
  // Amplify's default AsyncStorage (mobile/CLAUDE.md hard rule).
  cognitoUserPoolsTokenProvider.setKeyValueStorage(secureKeyValueStorage);
}

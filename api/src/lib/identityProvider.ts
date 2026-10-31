import {
  AdminGetUserCommand,
  UserNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";
import { parseCognitoIssuer } from "@logjam/shared";
import { cognitoIdpClient } from "../services/awsClients";
import { getEnv } from "./env";
import { logger, safeErrorForLog } from "./logger";

/** What the API asks the account directory behind the configured issuer. */
export interface IdentityProvider {
  /**
   * Whether the directory still holds this subject. True when unsure: a false
   * answer lets routes/users.ts re-point an account, so it must be certain.
   */
  userExists(sub: string): Promise<boolean>;
}

function cognitoProvider(region: string, poolId: string): IdentityProvider {
  const client = cognitoIdpClient(region);
  return {
    async userExists(sub) {
      try {
        await client.send(
          new AdminGetUserCommand({ UserPoolId: poolId, Username: sub }),
        );
        return true;
      } catch (err) {
        if (err instanceof UserNotFoundException) return false;
        // IAM not granted or network error — fail safe: treat as existing, but
        // say so, or a missing AdminGetUser permission silently disables the guard.
        logger.warn(
          { err: safeErrorForLog(err) },
          "identity_user_exists_check_failed",
        );
        return true;
      }
    },
  };
}

// No directory to ask (fake auth, or an issuer we have no adapter for): every
// identity exists, so the rebind never fires and the 409 stands.
const fallback: IdentityProvider = { userExists: async () => true };

export function identityProvider(): IdentityProvider {
  const cognito = parseCognitoIssuer(getEnv().OIDC_ISSUER ?? "");
  return cognito ? cognitoProvider(cognito.region, cognito.poolId) : fallback;
}

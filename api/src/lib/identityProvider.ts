import {
  AdminDeleteUserCommand,
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
  /**
   * Remove this subject's identity, after routes/users.ts has deleted
   * Logjam's data. Already gone counts as done; any other failure throws, and
   * the caller logs it without failing the account delete.
   */
  deleteUser(sub: string): Promise<void>;
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
    async deleteUser(sub) {
      try {
        await client.send(
          new AdminDeleteUserCommand({ UserPoolId: poolId, Username: sub }),
        );
      } catch (err) {
        if (err instanceof UserNotFoundException) return;
        throw err;
      }
    },
  };
}

// No directory to ask (fake auth, or an issuer we have no adapter for): every
// identity exists, so the rebind never fires and the 409 stands. Deleting is a
// no-op: with no adapter there is no directory Logjam may write to, so the
// identity outlives the account until its operator removes it.
const fallback: IdentityProvider = {
  userExists: async () => true,
  deleteUser: async () => {},
};

export function identityProvider(): IdentityProvider {
  const cognito = parseCognitoIssuer(getEnv().OIDC_ISSUER ?? "");
  return cognito ? cognitoProvider(cognito.region, cognito.poolId) : fallback;
}

// Cognito's account calls over plain fetch (no Amplify), for a Cognito issuer
// only. Change email and global sign-out take the access token, which needs the
// aws.cognito.signin.user.admin scope (oidc.ts). The sign-in and sign-up calls
// below them take the app client's id, and back Logjam Web's own forms
// (ADR 0045).
import { parseCognitoIssuer } from "./cognitoIssuer.js";

async function call(
  issuer: string,
  op: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const cognito = parseCognitoIssuer(issuer);
  if (!cognito) throw new Error("Not a Cognito issuer");
  const res = await fetch(
    `https://cognito-idp.${cognito.region}.amazonaws.com/`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${op}`,
      },
      body: JSON.stringify(body),
    },
  );
  if (res.ok) return (await res.json().catch(() => ({}))) ?? {};
  let type = "";
  let message = "";
  try {
    const j = (await res.json()) as { __type?: string; message?: string };
    type = j.__type ?? "";
    message = j.message ?? "";
  } catch {
    // non-JSON body: keep the status below
  }
  // The name is what mapAuthError reads, as it did with Amplify's errors.
  const err = new Error(message || `Cognito ${op} failed (${res.status})`);
  err.name = type.split("#").pop() || "CognitoError";
  throw err;
}

export const requestEmailChange = async (
  issuer: string,
  accessToken: string,
  email: string,
) => {
  await call(issuer, "UpdateUserAttributes", {
    AccessToken: accessToken,
    UserAttributes: [{ Name: "email", Value: email }],
  });
};

export const confirmEmailChange = async (
  issuer: string,
  accessToken: string,
  code: string,
) => {
  await call(issuer, "VerifyUserAttribute", {
    AccessToken: accessToken,
    AttributeName: "email",
    Code: code,
  });
};

export const globalSignOut = async (issuer: string, accessToken: string) => {
  await call(issuer, "GlobalSignOut", { AccessToken: accessToken });
};

export type CognitoTokens = {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

/**
 * Null: Cognito wants more than a password (MFA, a new password), which only
 * its own page can ask for. USER_AUTH, not USER_PASSWORD_AUTH: the app client
 * already allows it, and the pool's password stays the only first factor.
 */
export async function passwordSignIn(
  issuer: string,
  clientId: string,
  email: string,
  password: string,
): Promise<CognitoTokens | null> {
  const res = await call(issuer, "InitiateAuth", {
    ClientId: clientId,
    AuthFlow: "USER_AUTH",
    AuthParameters: {
      USERNAME: email,
      PREFERRED_CHALLENGE: "PASSWORD",
      PASSWORD: password,
    },
  });
  const t = res.AuthenticationResult as
    | {
        IdToken: string;
        AccessToken: string;
        RefreshToken: string;
        ExpiresIn: number;
      }
    | undefined;
  return t
    ? {
        idToken: t.IdToken,
        accessToken: t.AccessToken,
        refreshToken: t.RefreshToken,
        expiresIn: t.ExpiresIn,
      }
    : null;
}

export async function signUp(
  issuer: string,
  clientId: string,
  args: { email: string; password: string; name: string },
): Promise<void> {
  await call(issuer, "SignUp", {
    ClientId: clientId,
    Username: args.email,
    Password: args.password,
    UserAttributes: [
      { Name: "email", Value: args.email },
      { Name: "name", Value: args.name },
    ],
  });
}

export async function confirmSignUp(
  issuer: string,
  clientId: string,
  email: string,
  code: string,
): Promise<void> {
  await call(issuer, "ConfirmSignUp", {
    ClientId: clientId,
    Username: email,
    ConfirmationCode: code,
  });
}

export async function resendSignUpCode(
  issuer: string,
  clientId: string,
  email: string,
): Promise<void> {
  await call(issuer, "ResendConfirmationCode", {
    ClientId: clientId,
    Username: email,
  });
}

export async function forgotPassword(
  issuer: string,
  clientId: string,
  email: string,
): Promise<void> {
  await call(issuer, "ForgotPassword", { ClientId: clientId, Username: email });
}

export async function confirmForgotPassword(
  issuer: string,
  clientId: string,
  email: string,
  code: string,
  password: string,
): Promise<void> {
  await call(issuer, "ConfirmForgotPassword", {
    ClientId: clientId,
    Username: email,
    ConfirmationCode: code,
    Password: password,
  });
}

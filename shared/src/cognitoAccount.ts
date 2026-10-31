// Cognito's account calls with the access token, over plain fetch (no
// Amplify): change email and global sign-out. Each needs the
// aws.cognito.signin.user.admin scope (oidc.ts) and a Cognito issuer.
import { parseCognitoIssuer } from "./cognitoIssuer.js";

async function call(
  issuer: string,
  op: string,
  body: Record<string, unknown>,
): Promise<void> {
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
  if (res.ok) return;
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

export const requestEmailChange = (
  issuer: string,
  accessToken: string,
  email: string,
) =>
  call(issuer, "UpdateUserAttributes", {
    AccessToken: accessToken,
    UserAttributes: [{ Name: "email", Value: email }],
  });

export const confirmEmailChange = (
  issuer: string,
  accessToken: string,
  code: string,
) =>
  call(issuer, "VerifyUserAttribute", {
    AccessToken: accessToken,
    AttributeName: "email",
    Code: code,
  });

export const globalSignOut = (issuer: string, accessToken: string) =>
  call(issuer, "GlobalSignOut", { AccessToken: accessToken });

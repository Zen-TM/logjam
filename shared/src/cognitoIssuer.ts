const COGNITO_ISSUER =
  /^https:\/\/cognito-idp\.([a-z0-9-]+)\.amazonaws\.com\/([a-z0-9-]+_[A-Za-z0-9]+)$/;

/** Region and pool id of an Amazon Cognito issuer URL, or null for any other issuer. */
export function parseCognitoIssuer(
  issuer: string,
): { region: string; poolId: string } | null {
  const m = COGNITO_ISSUER.exec(issuer);
  return m ? { region: m[1], poolId: m[2] } : null;
}

/**
 * Change email, delete and sign out everywhere call Cognito directly, so a
 * client offers them only when its issuer is Cognito. Fake auth counts, so
 * the rows can be exercised in local dev.
 */
export function hasCognitoAccount(
  authMode: string | undefined,
  issuer: string | undefined,
): boolean {
  return (
    authMode === "fake" || (!!issuer && parseCognitoIssuer(issuer) !== null)
  );
}

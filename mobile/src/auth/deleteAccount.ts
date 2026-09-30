// "Delete account" ends the account in both places it lives: our database and
// Cognito, which holds the sign-in (email and password).
//
// Logjam GPS used to stop after the first, so the sign-in outlived an account
// the screen said was gone. The order matches Logjam Web
// (frontend/src/components/dialogs/DeleteAccountDialog.tsx): our own record
// first, because a Cognito user with no account row can still sign in and be
// repaired, where the reverse cannot.
import { deleteUser } from "aws-amplify/auth";

import { apiFetch } from "../api/apiFetch";
import { config } from "../config";

export async function deleteAccountEverywhere(): Promise<void> {
  await apiFetch<void>("/users/me", { method: "DELETE" });
  // Fake auth has no Cognito directory, so there is no sign-in to delete.
  if (config.authMode === "fake") return;
  await deleteUser();
}

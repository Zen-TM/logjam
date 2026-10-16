// "Delete account" ends the account in both places it lives: our database and
// Cognito, which holds the sign-in (email and password).
//
// Both must be deleted or the sign-in outlives an account the screen reported
// gone. The order matches Logjam Web
// (frontend/src/components/dialogs/DeleteAccountDialog.tsx): our own record
// first, because a Cognito user with no account row can still sign in and be
// repaired, where the reverse cannot (Guard: deleteAccount.test.ts).
import { deleteUser } from "aws-amplify/auth";

import { apiFetch } from "../api/apiFetch";
import { config } from "../config";

export async function deleteAccountEverywhere(): Promise<void> {
  await apiFetch<void>("/users/me", { method: "DELETE" });
  // Fake auth has no Cognito directory, so there is no sign-in to delete.
  if (config.authMode === "fake") return;
  await deleteUser();
}

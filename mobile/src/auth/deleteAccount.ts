// "Delete account" is one API call: the server deletes our records, then the
// sign-in at the identity provider (a failure there is logged server-side and
// does not fail the request). The client never touches the provider.
// Guard: deleteAccount.test.ts.
import { apiFetch } from "../api/apiFetch";

export async function deleteAccountEverywhere(): Promise<void> {
  await apiFetch<void>("/users/me", { method: "DELETE" });
}

// Guard: deleting an account from Logjam GPS removes the Cognito sign-in too.
// Dropping the `deleteUser()` call from deleteAccount.ts turns the first test
// red; calling it before the API delete turns the second red.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const apiFetchMock = vi.fn();
const deleteUserMock = vi.fn();
const config = { authMode: "cognito" };

vi.mock("../api/apiFetch", () => ({
  apiFetch: (path: string, init: { method: string }) => {
    calls.push(`${init.method} ${path}`);
    return apiFetchMock();
  },
}));
vi.mock("aws-amplify/auth", () => ({
  deleteUser: () => {
    calls.push("cognito deleteUser");
    return deleteUserMock();
  },
}));
vi.mock("../config", () => ({ config }));

const { deleteAccountEverywhere } = await import("./deleteAccount");

beforeEach(() => {
  calls.length = 0;
  apiFetchMock.mockReset().mockResolvedValue(undefined);
  deleteUserMock.mockReset().mockResolvedValue(undefined);
  config.authMode = "cognito";
});

describe("deleteAccountEverywhere", () => {
  it("deletes the account row, then the Cognito sign-in", async () => {
    await deleteAccountEverywhere();
    expect(calls).toEqual(["DELETE /users/me", "cognito deleteUser"]);
  });

  it("keeps the sign-in when the account row could not be deleted", async () => {
    apiFetchMock.mockRejectedValue(new Error("offline"));
    await expect(deleteAccountEverywhere()).rejects.toThrow("offline");
    expect(calls).toEqual(["DELETE /users/me"]);
  });

  it("reports a failed Cognito delete rather than claiming success", async () => {
    deleteUserMock.mockRejectedValue(new Error("expired"));
    await expect(deleteAccountEverywhere()).rejects.toThrow("expired");
  });

  it("skips Cognito under fake auth, which has none", async () => {
    config.authMode = "fake";
    await deleteAccountEverywhere();
    expect(calls).toEqual(["DELETE /users/me"]);
  });
});

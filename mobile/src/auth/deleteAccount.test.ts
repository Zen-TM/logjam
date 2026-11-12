// Guard: deleting an account from Logjam GPS is the API call alone; the server
// ends the sign-in. Re-adding a client-side identity delete (Amplify's
// deleteUser) turns the first test red, since the call list gains an entry.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const apiFetchMock = vi.fn();

vi.mock("../api/apiFetch", () => ({
  apiFetch: (path: string, init: { method: string }) => {
    calls.push(`${init.method} ${path}`);
    return apiFetchMock();
  },
}));
vi.mock("aws-amplify/auth", () => ({
  deleteUser: () => {
    calls.push("client deleteUser");
  },
}));

const { deleteAccountEverywhere } = await import("./deleteAccount");

beforeEach(() => {
  calls.length = 0;
  apiFetchMock.mockReset().mockResolvedValue(undefined);
});

describe("deleteAccountEverywhere", () => {
  it("only asks the API to delete the account", async () => {
    await deleteAccountEverywhere();
    expect(calls).toEqual(["DELETE /users/me"]);
  });

  it("reports a failed delete rather than claiming success", async () => {
    apiFetchMock.mockRejectedValue(new Error("offline"));
    await expect(deleteAccountEverywhere()).rejects.toThrow("offline");
  });
});

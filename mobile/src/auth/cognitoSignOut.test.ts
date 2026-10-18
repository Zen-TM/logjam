// Guard: signing out under fake auth never calls Amplify, which is not
// configured there (amplifyConfig.ts) and raises NoAmplifyContextError. Drop
// the fake-mode early return in cognitoSignOut.ts and the second test goes red;
// drop the `signOut()` call and the first does.
import { beforeEach, describe, expect, it, vi } from "vitest";

const signOutMock = vi.fn();
const config = { authMode: "cognito" };

vi.mock("aws-amplify/auth", () => ({ signOut: () => signOutMock() }));
vi.mock("../config", () => ({ config }));

const { cognitoSignOut } = await import("./cognitoSignOut");

beforeEach(() => {
  signOutMock.mockReset().mockResolvedValue(undefined);
  config.authMode = "cognito";
});

describe("cognitoSignOut", () => {
  it("signs out of Cognito", async () => {
    await cognitoSignOut();
    expect(signOutMock).toHaveBeenCalledOnce();
  });

  it("does not touch Amplify under fake auth, which never configures it", async () => {
    config.authMode = "fake";
    await cognitoSignOut();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("reports a failed Cognito sign-out to the caller", async () => {
    signOutMock.mockRejectedValue(new Error("offline"));
    await expect(cognitoSignOut()).rejects.toThrow("offline");
  });
});

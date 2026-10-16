// Cognito tokens live in Keychain/Keystore, never in Amplify's default
// AsyncStorage, which is plain files on the device.
import { describe, expect, it, vi } from "vitest";

const setKeyValueStorage = vi.fn();
vi.mock("aws-amplify", () => ({ Amplify: { configure: vi.fn() } }));
vi.mock("aws-amplify/auth/cognito", () => ({
  cognitoUserPoolsTokenProvider: { setKeyValueStorage },
}));
vi.mock("expo-secure-store", () => ({}));
vi.mock("../config", () => ({
  config: {
    authMode: "cognito",
    cognitoUserPoolId: "pool",
    cognitoClientId: "client",
  },
}));

const { configureAmplify } = await import("./amplifyConfig");
const { secureKeyValueStorage } = await import("./secureKeyValueStorage");

describe("configureAmplify", () => {
  // Mutation: delete the setKeyValueStorage call, or pass it another store.
  it("hands Amplify the SecureStore-backed token storage", () => {
    configureAmplify();
    expect(setKeyValueStorage).toHaveBeenCalledExactlyOnceWith(
      secureKeyValueStorage,
    );
  });
});

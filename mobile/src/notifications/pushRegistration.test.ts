import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerForPushNotifications } from "./pushRegistration";

// A guest has no account to register a push token against: registering would
// POST /devices with no session (ADR 0007).
//
// Mutation that turns it red: drop the `capabilityScreenBlock` line at the top
// of `registerForPushNotifications`, and the guest test sees the permission
// read and the POST.
const { getPermissionsAsync, getExpoPushTokenAsync, apiFetch } = vi.hoisted(
  () => ({
    getPermissionsAsync: vi.fn(),
    getExpoPushTokenAsync: vi.fn(),
    apiFetch: vi.fn(),
  }),
);

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-notifications", () => ({
  getPermissionsAsync,
  getExpoPushTokenAsync,
  setNotificationChannelAsync: vi.fn(),
  AndroidImportance: { DEFAULT: 3 },
}));
vi.mock("expo-secure-store", () => ({
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      android: { package: "com.logjamnsw.mobile" },
      extra: { eas: { projectId: "p" } },
    },
  },
}));
vi.mock("../api/apiFetch", () => ({ apiFetch }));
vi.mock("./pushAvailable", () => ({ pushAvailable: () => true }));

describe("registering this phone for pushes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPermissionsAsync.mockResolvedValue({ granted: true });
    getExpoPushTokenAsync.mockResolvedValue({ data: "ExponentPushToken[x]" });
    apiFetch.mockResolvedValue(undefined);
  });

  it("does nothing for a guest", async () => {
    await registerForPushNotifications("guest");
    expect(getPermissionsAsync).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("registers the token of a linked account", async () => {
    await registerForPushNotifications("linked");
    expect(apiFetch).toHaveBeenCalledWith("/devices", expect.anything());
  });
});

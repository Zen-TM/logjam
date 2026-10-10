import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("config", () => {
  // Mutation that turns it red: give webUrl a default host. A dev build would
  // then hand out friend invite links to whatever that default is.
  it("refuses to load without the Logjam Web URL", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "http://127.0.0.1:8080");
    vi.stubEnv("EXPO_PUBLIC_WEB_URL", "");
    await expect(import("./config")).rejects.toThrow("EXPO_PUBLIC_WEB_URL");
  });
});

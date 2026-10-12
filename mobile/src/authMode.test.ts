import { describe, expect, it } from "vitest";

import { resolveAuthMode } from "./authMode";

// Mutation that turns this red: drop the LOCAL_HOST check in resolveAuthMode
// (fake auth would then resolve for the prod API URL).
describe("resolveAuthMode", () => {
  it("defaults to cognito, whatever the API", () => {
    expect(resolveAuthMode(undefined, "https://api.logjamnsw.com")).toBe(
      "cognito",
    );
    expect(resolveAuthMode("cognito", "https://api.logjamnsw.com")).toBe(
      "cognito",
    );
  });

  it.each([
    "http://127.0.0.1:8080",
    "http://10.0.2.2:8080",
    "http://localhost:8080",
    "http://192.168.1.20:8080",
    "http://172.20.0.5:8080",
  ])("allows fake auth against %s", (url) => {
    expect(resolveAuthMode("fake", url)).toBe("fake");
  });

  it.each([
    "https://api.logjamnsw.com",
    "http://10.example.com",
    "http://172.32.0.1",
    "http://127.0.0.1.evil.com",
  ])("refuses fake auth against %s", (url) => {
    expect(() => resolveAuthMode("fake", url)).toThrow();
  });

  it("refuses an unknown mode instead of treating it as cognito or fake", () => {
    expect(() => resolveAuthMode("Fake", "http://127.0.0.1")).toThrow();
  });
});

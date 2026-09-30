// Guard: the links on Logjam GPS's consent screen point at documents Logjam Web
// actually publishes. Renaming frontend/public/privacy.html (or tos.html)
// without updating legalLinks.ts turns this red.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() } }));

const { PRIVACY_POLICY_URL, TERMS_URL } = await import("./legalLinks");

const publicDir = join(import.meta.dirname, "..", "..", "frontend", "public");

describe("legal document links", () => {
  it.each([TERMS_URL, PRIVACY_POLICY_URL])("%s is published", (url) => {
    const { origin, pathname } = new URL(url);
    expect(origin).toBe("https://logjamnsw.com");
    expect(existsSync(join(publicDir, pathname))).toBe(true);
  });
});

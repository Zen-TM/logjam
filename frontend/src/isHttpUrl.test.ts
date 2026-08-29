// FEUI-012: canyon `attributes.sources` URLs are free text stored verbatim
// and later emitted into an <a href>. isHttpUrl is the one gate both the
// CanyonDialog save path and the CanyonDetailPanel render path go through.
import { describe, it, expect, vi } from "vitest";
import { isHttpUrl } from "./canyonUtils";

vi.mock("aws-amplify/auth", () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: { idToken: { toString: () => "test-token" } },
  }),
}));

describe("isHttpUrl", () => {
  it("accepts http(s) URLs", () => {
    expect(isHttpUrl("https://example.com/route")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
  });

  it("rejects javascript: and other dangerous schemes", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isHttpUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects unparseable or empty strings", () => {
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl("example.com")).toBe(false); // no scheme — not a valid URL
  });
});

// @vitest-environment node
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CSP_PROD } from "../vite.config";

function extractCspProdHosts(csp: string): Set<string> {
  const targetDirectives = new Set(["img-src", "media-src", "connect-src"]);
  const hosts = new Set<string>();

  const directives = csp
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean);
  for (const directive of directives) {
    const tokens = directive.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const [name, ...sources] = tokens;
    if (targetDirectives.has(name)) {
      for (const source of sources) {
        if (source.startsWith("https://")) {
          hosts.add(source);
        }
      }
    }
  }

  return hosts;
}

function extractJsonHosts(allowlist: unknown): Set<string> {
  const hosts = new Set<string>();

  function collect(val: unknown) {
    if (typeof val === "string") {
      hosts.add(val);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        collect(item);
      }
    } else if (val && typeof val === "object") {
      for (const item of Object.values(val)) {
        collect(item);
      }
    }
  }

  collect(allowlist);
  return hosts;
}

describe("CSP allowlist agreement", () => {
  it("keeps CSP_PROD in vite.config.ts and cspAllowlist in scripts/csp-policy.json in sync", () => {
    const jsonPath = fileURLToPath(
      new URL("../../scripts/csp-policy.json", import.meta.url),
    );
    const rawJson = fs.readFileSync(jsonPath, "utf-8");
    const parsed = JSON.parse(rawJson);

    const viteHosts = extractCspProdHosts(CSP_PROD);
    const jsonHosts = extractJsonHosts(parsed.cspAllowlist);

    const onlyInVite = [...viteHosts].filter((h) => !jsonHosts.has(h)).sort();
    const onlyInJson = [...jsonHosts].filter((h) => !viteHosts.has(h)).sort();

    if (onlyInVite.length > 0 || onlyInJson.length > 0) {
      const failureParts: string[] = [];
      if (onlyInVite.length > 0) {
        failureParts.push(
          `Only in vite.config.ts (CSP_PROD):\n  ${onlyInVite.join("\n  ")}`,
        );
      }
      if (onlyInJson.length > 0) {
        failureParts.push(
          `Only in scripts/csp-policy.json (cspAllowlist):\n  ${onlyInJson.join("\n  ")}`,
        );
      }
      expect.fail(`CSP allowlists disagree:\n\n${failureParts.join("\n\n")}`);
    }

    expect(viteHosts).toEqual(jsonHosts);
  });
});

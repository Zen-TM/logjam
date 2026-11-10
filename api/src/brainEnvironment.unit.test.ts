// infra/brain/api.env is the API's complete non-secret environment on the
// brain. Every variable in it is one the schema (lib/env.ts) declares, it sets
// the brain's own database host, certificate and proxy hops, and it leaves
// LOGJAM_RUNTIME and secrets to the host.
//
// Mutation that turns it red: adding `LOGJAM_RUNTIME=prod`, `SMTP_PASSWORD=x`
// or a variable the schema lacks to the file, or changing DB_HOST,
// DATABASE_SSL_CA or TRUST_PROXY_HOPS.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const api = join(import.meta.dirname, "..");
const schema = readFileSync(join(api, "src", "lib", "env.ts"), "utf8");

function parseEnvFile(text: string): [string, string][] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"))
    .map((line) => [
      line.slice(0, line.indexOf("=")),
      line.slice(line.indexOf("=") + 1),
    ]);
}

const brain = parseEnvFile(
  readFileSync(join(api, "..", "infra", "brain", "api.env"), "utf8"),
);
const brainMap = new Map(brain);

describe("infra/brain/api.env", () => {
  it("sets only variables the API's schema declares", () => {
    expect(brain.length).toBeGreaterThan(20);
    expect(
      brain.filter(([key]) => !new RegExp(`^  ${key}: z`, "m").test(schema)),
    ).toEqual([]);
  });

  it("sets no variable twice", () => {
    expect(
      brain.filter(([key], i) => brain.findIndex(([k]) => k === key) !== i),
    ).toEqual([]);
  });

  it("holds no secret and leaves the host's runtime marker to the host", () => {
    const keys = brain.map(([key]) => key);
    expect(
      keys.filter((key) => /(PASSWORD|SECRET|TOKEN|KEY)$/.test(key)),
    ).toEqual([]);
    expect(keys).not.toContain("LOGJAM_RUNTIME");
  });

  it("names the Compose database, its certificate and the one proxy hop", () => {
    expect(brainMap.get("DB_HOST")).toBe("postgres");
    expect(brainMap.get("DATABASE_SSL_CA")).toBe("/app/brain-ca.pem");
    expect(brainMap.get("TRUST_PROXY_HOPS")).toBe("1");
  });
});

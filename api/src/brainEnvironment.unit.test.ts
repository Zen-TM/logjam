// infra/brain/api.env is the API's complete non-secret environment on the
// brain. Every variable in it is one the schema (lib/env.ts) declares, it sets
// the brain's own database host, certificate and proxy hops, and it leaves
// LOGJAM_RUNTIME and secrets to the host.
//
// Mutation that turns it red: adding `LOGJAM_RUNTIME=prod`, `SMTP_PASSWORD=x`
// or a variable the schema lacks to the file, or changing DB_HOST,
// DATABASE_SSL_CA or TRUST_PROXY_HOPS; deleting a variable prod needs
// (S3_BUCKET_MEDIA, CORS_ORIGIN, OIDC_ISSUER) from the file.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateEnv } from "./lib/env";

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

  // The download meter charges only S3 reads signed by the API's own role,
  // which it finds by this substring of the access log's requester. The
  // schema's default is empty, which matches nothing.
  // Mutation: deleting the line from api.env, or renaming the brain's role in
  // brain_iam.tf: the meter then matches nothing and no download is counted.
  it("tells the download meter the role the brain's API signs with", () => {
    const iam = readFileSync(
      join(api, "..", "infra/terraform/envs/prod/brain_iam.tf"),
      "utf8",
    );
    const role = /resource "aws_iam_role" "brain" \{\s+name\s+= "([^"]+)"/.exec(
      iam,
    )?.[1];
    expect(role).toBeTruthy();
    expect(brainMap.get("EGRESS_API_REQUESTER_PATTERN")).toBe(
      `assumed-role/${role}/`,
    );
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

  // What the host adds at boot: boot.ts resolves the database user and password
  // and the origin-verify secret from Secrets Manager, and release-agent.sh
  // adds LOGJAM_RUNTIME. Everything else prod needs must be in the file.
  describe("boot", () => {
    const original = { ...process.env };
    afterEach(() => {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, original);
    });

    it("validates with exactly what api.env and the host's secrets provide", () => {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, Object.fromEntries(brain), {
        LOGJAM_RUNTIME: "prod",
        DB_USER: "host-resolved",
        DB_PASSWORD: "host-resolved",
        ORIGIN_VERIFY_SECRET: "host-resolved",
      });
      const exit = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit: prod would refuse to boot");
      }) as never);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        let refused = false;
        try {
          validateEnv();
        } catch {
          refused = true;
        }
        expect(
          refused,
          "infra/brain/api.env lacks a variable prod needs; add it there. " +
            `validateEnv said: ${error.mock.calls.flat().join(" ")}`,
        ).toBe(false);
      } finally {
        exit.mockRestore();
        error.mockRestore();
      }
    });
  });
});

// infra/brain/api.env is the API's complete non-secret environment on the
// brain. Every variable in it is one the schema (lib/env.ts) declares, it
// keeps today's Elastic Beanstalk values, and it leaves LOGJAM_RUNTIME and
// secrets to the host.
//
// Mutation that turns it red: adding `LOGJAM_RUNTIME=prod` or `SMTP_PASSWORD=x`
// to the file, changing a shared value from what .ebextensions sets, or
// dropping a variable .ebextensions still sets.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const api = join(import.meta.dirname, "..");
const schema = readFileSync(join(api, "src", "lib", "env.ts"), "utf8");
const ebDir = join(api, ".ebextensions");

function parseEnvFile(text: string): [string, string][] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"))
    .map((line) => [
      line.slice(0, line.indexOf("=")),
      line.slice(line.indexOf("=") + 1),
    ]);
}

function ebEnvironment(text: string): [string, string][] {
  const start = text.indexOf("aws:elasticbeanstalk:application:environment:");
  if (start === -1) return [];
  const pairs: [string, string][] = [];
  for (const line of text.slice(start).split("\n").slice(1)) {
    const match = /^ {4}([A-Z0-9_]+): "?([^"]*)"?$/.exec(line);
    if (!match) break;
    pairs.push([match[1], match[2]]);
  }
  return pairs;
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
  // schema's default names the role the API had on Elastic Beanstalk.
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

  it("differs from Elastic Beanstalk only in the database host, its CA and the proxy hops", () => {
    expect(brainMap.get("DB_HOST")).toBe("postgres");
    expect(brainMap.get("DATABASE_SSL_CA")).toBe("/app/brain-ca.pem");
    expect(brainMap.get("TRUST_PROXY_HOPS")).toBe("1");
  });

  // The directory goes when Elastic Beanstalk does; the file then stands alone.
  describe.skipIf(!existsSync(ebDir))("against .ebextensions", () => {
    const eb = readdirSync(ebDir)
      .filter((file) => file.endsWith(".config"))
      .flatMap((file) =>
        ebEnvironment(readFileSync(join(ebDir, file), "utf8")),
      );
    const different = new Set(["DB_HOST"]);

    it("sets every variable Elastic Beanstalk sets", () => {
      expect(eb.length).toBeGreaterThan(15);
      expect(eb.filter(([key]) => !brainMap.has(key))).toEqual([]);
    });

    it("keeps their values", () => {
      expect(
        eb.filter(
          ([key, value]) => !different.has(key) && brainMap.get(key) !== value,
        ),
      ).toEqual([]);
    });
  });
});

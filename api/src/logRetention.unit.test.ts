// One retention figure for every operational log, declared once as
// local.operational_log_retention_days (infra/terraform/envs/prod/logging.tf).
// privacy.html states it and Terraform applies it; this holds both to the one
// local, and the published audit figure to var.audit_log_retention_days.
//
// Mutations that turn it red: a literal `retention_in_days = 90` on any log
// group, a literal `expiration_days` on the access-logs rule, or either figure
// in privacy.html edited without the Terraform that enforces it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repo = join(import.meta.dirname, "..", "..");
const prodDir = join(repo, "infra", "terraform", "envs", "prod");
const read = (...parts: string[]) => readFileSync(join(repo, ...parts), "utf8");

const terraform = readdirSync(prodDir)
  .filter((file) => file.endsWith(".tf"))
  .map((file) => ({ file, text: readFileSync(join(prodDir, file), "utf8") }));

function captureNumber(text: string, pattern: RegExp, what: string): number {
  const match = pattern.exec(text);
  if (!match) throw new Error(`${what} not found`);
  return Number(match[1]);
}

const operationalDays = captureNumber(
  read("infra", "terraform", "envs", "prod", "logging.tf"),
  /operational_log_retention_days\s*=\s*(\d+)/,
  "local.operational_log_retention_days",
);

const auditDays = captureNumber(
  read("infra", "terraform", "envs", "prod", "audit.tf"),
  /variable "audit_log_retention_days" \{[\s\S]*?default\s*=\s*(\d+)/,
  "var.audit_log_retention_days default",
);

/** The day count inside a page's <li id="…">. */
function publishedDays(id: string, page = "privacy.html"): number {
  const html = read("frontend", "public", page);
  const item = new RegExp(`<li id="${id}">([\\s\\S]*?)</li>`).exec(html)?.[1];
  if (!item) throw new Error(`${page} has no <li id="${id}">`);
  return captureNumber(item, /(\d+) days/, `the day count in #${id}`);
}

describe("log retention", () => {
  it("sets every Terraform log group from the one local", () => {
    const settings = terraform.flatMap(({ file, text }) =>
      [...text.matchAll(/retention_in_days\s*=\s*(\S+)/g)].map(
        (match) => `${file}: ${match[1]}`,
      ),
    );
    // A parse that found nothing would pass the check below.
    expect(settings.length).toBeGreaterThan(5);
    expect(
      settings.filter(
        (setting) => !setting.endsWith("local.operational_log_retention_days"),
      ),
    ).toEqual([]);
  });

  it("expires the S3 access logs on the same figure", () => {
    const s3 = terraform.find(({ file }) => file === "s3.tf")?.text ?? "";
    const rule =
      /id\s*=\s*"expire-access-logs"[\s\S]*?expiration_days\s*=\s*(\S+)/.exec(
        s3,
      )?.[1];
    expect(rule).toBe("local.operational_log_retention_days");
  });

  it("publishes the figures Terraform enforces", () => {
    expect(publishedDays("retention-operational")).toBe(operationalDays);
    expect(publishedDays("retention-audit")).toBe(auditDays);
  });

  it("states the same figures on the delete-account page", () => {
    const page = "delete-account.html";
    expect(publishedDays("retention-operational", page)).toBe(operationalDays);
    expect(publishedDays("retention-audit", page)).toBe(auditDays);
  });
});

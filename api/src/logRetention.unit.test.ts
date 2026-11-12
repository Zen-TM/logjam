// One retention figure for every operational log, declared once as
// local.operational_log_retention_days (infra/terraform/envs/prod/logging.tf).
// privacy.html and delete-account.html state it and Terraform applies it; this
// holds both to the one local, and the published audit figure to
// var.audit_log_retention_days. The published backup figure must also cover
// how long a backup lives: pgBackRest's full-backup count plus the days the
// bucket keeps a deleted version.
//
// Mutations that turn it red: a literal `retention_in_days = 90` on any log
// group, a literal `expiration_days` on the access-logs rule, either figure
// in privacy.html or delete-account.html edited without the Terraform that
// enforces it, or `repo1-retention-full` raised to 10 in pgbackrest-conf.sh.
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

const backupDays =
  captureNumber(
    read("infra", "brain", "postgres", "pgbackrest-conf.sh"),
    /repo1-retention-full=(\d+)/,
    "repo1-retention-full",
  ) +
  captureNumber(
    read("infra", "terraform", "envs", "prod", "brain_s3.tf"),
    /clean-up-noncurrent-versions[\s\S]*?noncurrent_days\s*=\s*(\d+)/,
    "the backup bucket's noncurrent_days",
  );

/** The day count inside a page's <li id="…"> or <p id="…">. */
function publishedDays(id: string, page = "privacy.html"): number {
  const html = read("frontend", "public", page);
  const item = new RegExp(`<(li|p) id="${id}">([\\s\\S]*?)</\\1>`).exec(
    html,
  )?.[2];
  if (!item) throw new Error(`${page} has no element with id="${id}"`);
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

  it.each(["privacy.html", "delete-account.html"])(
    "%s states a backup figure that covers the backup settings",
    (page) => {
      expect(publishedDays("retention-backups", page)).toBeGreaterThanOrEqual(
        backupDays,
      );
    },
  );
});

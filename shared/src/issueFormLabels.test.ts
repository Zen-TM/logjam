// Every label an issue form applies is declared in the Terraform that creates
// the repo's labels: a form cannot apply a label that does not exist, and
// GitHub drops it silently.
//
// Mutation that turns it red: add a label to a form's `labels:` that
// infra/terraform/envs/github/labels.tf doesn't declare.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repo = join(import.meta.dirname, "..", "..");
const forms = join(repo, ".github", "ISSUE_TEMPLATE");
const labelsTf = readFileSync(
  join(repo, "infra", "terraform", "envs", "github", "labels.tf"),
  "utf8",
);

const declared = [...labelsTf.matchAll(/^\s+([a-z-]+)\s+=\s+\{ color/gm)].map(
  (match) => match[1],
);

const used = readdirSync(forms)
  .filter((file) => file.endsWith(".yml") && file !== "config.yml")
  .flatMap((file) => {
    const line = readFileSync(join(forms, file), "utf8").match(
      /^labels:\s*\[(.*)\]$/m,
    );
    return (line?.[1] ?? "")
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean)
      .map((label) => ({ file, label }));
  });

describe("issue form labels", () => {
  it("finds the forms and the declared labels", () => {
    // A parse that found nothing would pass the check below.
    expect(declared.length).toBeGreaterThan(3);
    expect(used.length).toBeGreaterThan(3);
  });

  it("applies only labels labels.tf declares", () => {
    const missing = used
      .filter(({ label }) => !declared.includes(label))
      .map(({ file, label }) => `${file}: ${label}`);
    expect(missing).toEqual([]);
  });
});

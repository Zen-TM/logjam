// Every file path an ADR names still exists (docs/decisions/README.md). The
// decisions directory is searched by the paths a
// change touches, so an ADR citing a moved file is invisible to the change it
// governs. The fix for a failure is to edit the ADR's path in place, in the
// change that moved the file.
//
// Mutation that turns it red: rename any backticked path in an ADR, or move a
// file one cites without updating it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repo = join(import.meta.dirname, "..", "..");
const decisions = join(repo, "docs", "decisions");

// ADRs write paths relative to the package or directory they are about.
const ROOTS = [
  "",
  "api/",
  "api/src/",
  "mobile/",
  "mobile/src/",
  "frontend/",
  "frontend/src/",
  "shared/",
  "shared/src/",
  "topo/",
  "infra/",
  "infra/terraform/envs/prod/",
];

// Paths an ADR names BECAUSE they are gone, or that are not repo paths (a
// Terraform state key).
const NAMED_AS_DELETED: Record<string, string[]> = {
  "0016-share-versus-send-a-copy.md": ["screens/ReceivedFilesScreen.tsx"],
  "0025-github-settings-in-terraform.md": [
    "scripts/github-settings.sh",
    "github/terraform.tfstate",
  ],
};

// A backticked token with a slash that ends in an extension or a slash. Globs
// and placeholders (`*`, `<…>`, `NNNN`) are not paths and do not match.
const PATH = /`([A-Za-z0-9_.+@-]+(?:\/[A-Za-z0-9_.+@[\]-]+)+(?:\.[a-z]+|\/))`/g;

const adrs = readdirSync(decisions).filter(
  (file) => /^\d{4}-.*\.md$/.test(file) && !file.startsWith("0000-"),
);

describe("ADR references", () => {
  it("finds the ADRs and their paths", () => {
    // A parse that found nothing would pass the check below.
    expect(adrs.length).toBeGreaterThan(10);
  });

  it("names only paths that exist", () => {
    const missing = adrs.flatMap((file) => {
      const text = readFileSync(join(decisions, file), "utf8");
      const allowed = NAMED_AS_DELETED[file] ?? [];
      return [...text.matchAll(PATH)]
        .map((match) => match[1])
        .filter((path) => !allowed.includes(path))
        .filter(
          (path) => !ROOTS.some((root) => existsSync(join(repo, root + path))),
        )
        .map((path) => `${file}: ${path}`);
    });
    expect(
      missing,
      "update each path in place (docs/decisions/README.md)",
    ).toEqual([]);
  });

  it("allows deleted paths only where the ADR still names them", () => {
    const stale = Object.entries(NAMED_AS_DELETED).flatMap(([file, paths]) => {
      const text = readFileSync(join(decisions, file), "utf8");
      return paths.filter((path) => !text.includes(`\`${path}\``));
    });
    expect(stale).toEqual([]);
  });
});

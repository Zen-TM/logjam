// scripts/check-eas-env.sh, run for real with a stub `eas` first on PATH.
// Mutation: drop either name from its loop, or `exit 1`, and a build without it
// starts, compiles and then throws on every launch.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(__dirname, "..", "scripts", "check-eas-env.sh");
const ISSUER = "EXPO_PUBLIC_OIDC_ISSUER=https://example.com/pool";
const CLIENT = "EXPO_PUBLIC_OIDC_CLIENT_ID=abc";

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function check(easOutput: string[], easExit = 0, cwd = process.cwd()) {
  dir = mkdtempSync(join(tmpdir(), "eas-stub-"));
  const lines = easOutput.map((l) => `echo '${l}'`).join("\n");
  // Only mobile/ has an eas.json, and eas refuses without one.
  writeFileSync(
    join(dir, "eas"),
    `#!/bin/sh\n[ -f eas.json ] || exit 2\n${lines}\nexit ${easExit}\n`,
  );
  chmodSync(join(dir, "eas"), 0o755);
  return spawnSync(SCRIPT, ["production"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
  });
}

describe("check-eas-env.sh", () => {
  it("passes with both set", () => {
    expect(check([CLIENT, ISSUER]).status).toBe(0);
  });

  it("passes a sensitive variable, which eas lists masked", () => {
    expect(check([`${ISSUER.split("=")[0]}=*****`, CLIENT]).status).toBe(0);
  });

  it.each([
    ["EXPO_PUBLIC_OIDC_ISSUER", [CLIENT]],
    ["EXPO_PUBLIC_OIDC_CLIENT_ID", [ISSUER]],
    ["EXPO_PUBLIC_OIDC_ISSUER", ["EXPO_PUBLIC_OIDC_ISSUER=", CLIENT]],
  ])("names %s when it is missing or empty", (name, vars) => {
    const run = check(vars);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`${name} is not set`);
  });

  // Mutation: drop the script's `cd`, and eas, run outside mobile/, finds no
  // project and writes an app.json where it stands.
  it("runs eas from mobile/, wherever it is called from", () => {
    expect(check([CLIENT, ISSUER], 0, "/").status).toBe(0);
  });

  it("fails when eas cannot answer", () => {
    expect(check([CLIENT, ISSUER], 1).status).not.toBe(0);
  });
});

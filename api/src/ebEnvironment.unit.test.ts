// Every environment variable .ebextensions sets on the prod API is one the
// API's schema (lib/env.ts) declares. A variable the code stopped reading
// otherwise stays in the bundle, and on the environment, for good.
//
// Mutation that turns it red: adding `SQS_QUEUE_URL: x` to any .config file
// here, or deleting a key from the schema while a file still sets it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const api = join(import.meta.dirname, "..");
const dir = join(api, ".ebextensions");
const schema = readFileSync(join(api, "src", "lib", "env.ts"), "utf8");

function environmentKeys(text: string): string[] {
  const start = text.indexOf("aws:elasticbeanstalk:application:environment:");
  if (start === -1) return [];
  const keys: string[] = [];
  for (const line of text.slice(start).split("\n").slice(1)) {
    const match = /^ {4}([A-Z0-9_]+):/.exec(line);
    if (!match) break;
    keys.push(match[1]);
  }
  return keys;
}

describe("the EB environment set from .ebextensions", () => {
  const set = readdirSync(dir)
    .filter((file) => file.endsWith(".config"))
    .flatMap((file) => environmentKeys(readFileSync(join(dir, file), "utf8")));

  it("sets only variables the API's schema declares", () => {
    expect(set.length).toBeGreaterThan(20);
    expect(
      set.filter((key) => !new RegExp(`^  ${key}: z`, "m").test(schema)),
    ).toEqual([]);
  });

  it("sets no variable twice", () => {
    expect(set.filter((key, i) => set.indexOf(key) !== i)).toEqual([]);
  });
});

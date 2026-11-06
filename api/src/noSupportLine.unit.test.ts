import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// Logjam has no support desk, so a sentence a user can read must not send them
// to one. Mutation: put "Contact support" back in any string under api/src.
it("no user-facing string sends anyone to support", () => {
  const offenders = (readdirSync(__dirname, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".ts") && !/\.test\.ts$/.test(f))
    .filter((f) =>
      /contact support/i.test(readFileSync(join(__dirname, f), "utf8")),
    );
  expect(offenders).toEqual([]);
});

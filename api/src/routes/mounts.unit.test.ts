import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// queryPlans.test.ts reads every GET from ROUTER_MOUNTS, so a router index.ts
// imported and mounted itself would skip that guard. Mutation: import a router
// from ./routes/<name> in index.ts.
it("index.ts takes its routers only from ROUTER_MOUNTS", () => {
  const source = readFileSync(join(__dirname, "../index.ts"), "utf8");
  expect(source.match(/from "\.\/routes\/(?!mounts")[^"]+"/g)).toBeNull();
});

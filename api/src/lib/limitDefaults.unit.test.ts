import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MONTHLY_COMPUTE_CREDITS,
  DEFAULT_MONTHLY_EGRESS_BYTES,
} from "@logjam/shared";

// A new account's allowances are the schema's column defaults, and the shared
// constants are what clients and docs name: two lists that must agree.
//
// Mutation that turns it red: change DEFAULT_MONTHLY_COMPUTE_CREDITS or
// DEFAULT_MONTHLY_EGRESS_BYTES in shared/src/computeCredits.ts, or the
// `@default(...)` of monthlyComputeCredits or monthlyEgressQuotaBytes in
// prisma/schema.prisma, without the other.
const schema = readFileSync(
  join(import.meta.dirname, "..", "..", "prisma", "schema.prisma"),
  "utf8",
);
const defaultOf = (field: string) =>
  schema.match(
    new RegExp(`^\\s*${field}\\s+\\w+\\s+@default\\((\\d+)\\)`, "m"),
  )?.[1];

describe("the schema's allowance defaults match the shared constants", () => {
  it("compute credits", () => {
    expect(defaultOf("monthlyComputeCredits")).toBe(
      String(DEFAULT_MONTHLY_COMPUTE_CREDITS),
    );
  });

  it("download bytes", () => {
    expect(defaultOf("monthlyEgressQuotaBytes")).toBe(
      String(DEFAULT_MONTHLY_EGRESS_BYTES),
    );
  });
});

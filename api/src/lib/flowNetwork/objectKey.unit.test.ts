import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FLOW_NETWORK_KEY } from "./objectKey";

// docs/decisions/0034: the layer is read by the API alone, so the CDN must
// never serve it, or anyone could download the whole network.
describe("FLOW_NETWORK_KEY", () => {
  // Mutation: move the layer under master/ (beside the DEM archive), and
  // CloudFront serves it to anyone.
  it("is outside every prefix the CDN reads from the topo bucket", () => {
    const policies = readFileSync(
      join(__dirname, "../../../../infra/terraform/envs/prod/s3_policies.tf"),
      "utf8",
    );
    const served = [
      ...policies.matchAll(/topo_jobs\.bucket_arn\}\/([^"*]*)\*/g),
    ].map((m) => m[1]!);
    expect(served.length).toBeGreaterThan(0);
    for (const prefix of served) {
      expect(FLOW_NETWORK_KEY.startsWith(prefix)).toBe(false);
    }
  });
});

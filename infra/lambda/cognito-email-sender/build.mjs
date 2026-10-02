import { build } from "esbuild";

// Single-file CJS bundle for the Lambda. The Node 20 Lambda runtime ships the
// AWS SDK v3 clients (client-kms, used transitively by @aws-crypto/client-node,
// and client-secrets-manager) — keep those external so we don't ship a second
// copy. resend and @aws-crypto are bundled, and so are the DynamoDB packages
// @aws-crypto/client-node 5 requires at load for its branch keystore (unused
// here): the runtime is not guaranteed to ship util-dynamodb, and a missing
// module at load would fail every invocation.
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/index.js",
  external: ["@aws-sdk/client-kms", "@aws-sdk/client-secrets-manager"],
  minify: false,
  sourcemap: false,
});

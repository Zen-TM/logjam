import { build } from "esbuild";

// Single-file CJS bundle for the Lambda. The Node 20 Lambda runtime ships the
// AWS SDK v3 (incl. client-kms, used transitively by @aws-crypto/client-node,
// and client-secrets-manager) — keep those external so we don't ship a second
// copy. resend and @aws-crypto are bundled.
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/index.js",
  external: ["@aws-sdk/*"],
  minify: false,
  sourcemap: false,
});

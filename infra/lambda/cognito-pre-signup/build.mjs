import { build } from "esbuild";

// Single-file CJS bundle. The Lambda runtime ships the AWS SDK v3 clients, so
// client-dynamodb stays external and nothing else needs bundling.
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "dist/index.js",
  external: ["@aws-sdk/client-dynamodb"],
  minify: false,
  sourcemap: false,
});

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import fs from "fs";
import path from "path";

// CSP injected only on production build. Vite dev server uses inline scripts +
// eval for HMR, both of which would be blocked by 'self' policies.
//
// Source of truth for the policy string: CSP_PROD below (the string actually shipped).
// scripts/csp-policy.json mirrors it, guarded by frontend/src/cspAgreement.test.ts.
export const CSP_PROD = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.cloudfront.net https://*.s3.ap-southeast-2.amazonaws.com https://tile.openstreetmap.org https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org https://a.tile-cyclosm.openstreetmap.fr https://b.tile-cyclosm.openstreetmap.fr https://c.tile-cyclosm.openstreetmap.fr https://a.tile.opentopomap.org https://b.tile.opentopomap.org https://c.tile.opentopomap.org https://protomaps.github.io https://maps.six.nsw.gov.au https://elevation.fsdf.org.au https://s3.amazonaws.com",
  "font-src 'self' data:",
  "media-src 'self' blob: https://*.cloudfront.net https://*.s3.ap-southeast-2.amazonaws.com",
  "connect-src 'self' https://api.logjamnsw.com https://cognito-idp.ap-southeast-2.amazonaws.com https://*.auth.ap-southeast-2.amazoncognito.com https://*.cloudfront.net https://*.s3.ap-southeast-2.amazonaws.com https://tile.openstreetmap.org https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org https://a.tile-cyclosm.openstreetmap.fr https://b.tile-cyclosm.openstreetmap.fr https://c.tile-cyclosm.openstreetmap.fr https://a.tile.opentopomap.org https://b.tile.opentopomap.org https://c.tile.opentopomap.org https://protomaps.github.io https://maps.six.nsw.gov.au https://elevation.fsdf.org.au https://nominatim.openstreetmap.org https://s3.amazonaws.com",
  "worker-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

function cspMetaPlugin(): Plugin {
  return {
    name: "csp-meta",
    apply: "build",
    transformIndexHtml(html) {
      const metaTags = [
        `<meta http-equiv="Content-Security-Policy" content="${CSP_PROD}">`,
        `<meta name="referrer" content="strict-origin-when-cross-origin">`,
      ].join("\n    ");
      return html.replace("<head>", `<head>\n    ${metaTags}`);
    },
  };
}

// maplibre-gl 6's worker imports "./maplibre-gl-shared.mjs" by name, so the two
// files must sit side by side under their original names. deploy-frontend.yml
// serves every asset `immutable` and keeps old releases' files, so the pair goes
// in a directory named by a hash of both files: a fixed path would let a browser
// or CloudFront pair one release's worker with another's cached shared chunk.
// Test: src/maplibreWorkerPlugin.test.ts.
const MAPLIBRE_WORKER_URL_MODULE = "virtual:maplibre-worker-url";
const MAPLIBRE_WORKER_FILES = [
  "maplibre-gl-worker.mjs",
  "maplibre-gl-shared.mjs",
] as const;

export function maplibreWorkerPlugin(
  distDir = path.resolve(import.meta.dirname, "node_modules/maplibre-gl/dist"),
): Plugin {
  let base = "/";
  let isBuild = false;
  const read = () =>
    MAPLIBRE_WORKER_FILES.map(
      (name) => [name, fs.readFileSync(path.join(distDir, name))] as const,
    );
  const hashedDir = (files: ReturnType<typeof read>) => {
    const hash = createHash("sha256");
    for (const [name, source] of files) hash.update(name).update(source);
    return `assets/maplibre-${hash.digest("hex").slice(0, 10)}`;
  };
  return {
    name: "maplibre-worker",
    configResolved(config) {
      base = config.base;
      isBuild = config.command === "build";
    },
    resolveId(id) {
      if (id === MAPLIBRE_WORKER_URL_MODULE) return `\0${id}`;
    },
    load(id) {
      if (id !== `\0${MAPLIBRE_WORKER_URL_MODULE}`) return;
      // Dev serves node_modules as-is, so the worker finds its sibling there.
      const url = isBuild
        ? `${base}${hashedDir(read())}/${MAPLIBRE_WORKER_FILES[0]}`
        : `/node_modules/maplibre-gl/dist/${MAPLIBRE_WORKER_FILES[0]}`;
      return `export default ${JSON.stringify(url)};`;
    },
    generateBundle() {
      const files = read();
      const dir = hashedDir(files);
      for (const [name, source] of files) {
        this.emitFile({ type: "asset", fileName: `${dir}/${name}`, source });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  // Pin the dev port. strictPort makes Vite fail loudly if 5173 is taken
  // (e.g. an orphaned server from a prior session) instead of silently
  // falling back to 5174 — which the API's CORS_ORIGIN (localhost:5173)
  // would then reject, surfacing as a confusing "CORS request did not
  // succeed" rather than the real cause.
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // The Protomaps PMTiles archive lives behind the web distribution's
      // ordered /master/* behaviour, so in PROD it is same-origin and needs
      // nothing. In dev the app is on localhost, and the CDN sends no
      // Access-Control-Allow-Origin — CloudFront custom response-headers
      // policies are gated behind the AWS Business plan, so CORS can't simply
      // be switched on. Proxying keeps the archive same-origin in dev too,
      // which also means the app never needs a CDN base URL: it always
      // fetches /master/* from its own origin.
      "/master": {
        target: "https://logjamnsw.com",
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), cspMetaPlugin(), maplibreWorkerPlugin()],
  resolve: {
    alias: {
      "@styles": path.resolve(import.meta.dirname, "src/styles"),
    },
  },
});

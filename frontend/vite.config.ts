import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// CSP injected only on production build. Vite dev server uses inline scripts +
// eval for HMR, both of which would be blocked by 'self' policies.
//
// Source of truth for the policy string: scripts/csp-policy.json at repo root.
// Mirror any allowlist additions there.
const CSP_PROD = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.cloudfront.net https://*.s3.ap-southeast-2.amazonaws.com https://tile.openstreetmap.org https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org https://a.tile-cyclosm.openstreetmap.fr https://b.tile-cyclosm.openstreetmap.fr https://c.tile-cyclosm.openstreetmap.fr https://a.tile.opentopomap.org https://b.tile.opentopomap.org https://c.tile.opentopomap.org https://protomaps.github.io https://maps.six.nsw.gov.au https://elevation.fsdf.org.au",
  "font-src 'self' data:",
  "media-src 'self' blob: https://*.cloudfront.net https://*.s3.ap-southeast-2.amazonaws.com",
  "connect-src 'self' https://api.logjamnsw.com https://cognito-idp.ap-southeast-2.amazonaws.com https://*.auth.ap-southeast-2.amazoncognito.com https://*.cloudfront.net https://*.s3.ap-southeast-2.amazonaws.com https://tile.openstreetmap.org https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org https://a.tile-cyclosm.openstreetmap.fr https://b.tile-cyclosm.openstreetmap.fr https://c.tile-cyclosm.openstreetmap.fr https://a.tile.opentopomap.org https://b.tile.opentopomap.org https://c.tile.opentopomap.org https://protomaps.github.io https://maps.six.nsw.gov.au https://elevation.fsdf.org.au https://nominatim.openstreetmap.org",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ')

function cspMetaPlugin(): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      const metaTags = [
        `<meta http-equiv="Content-Security-Policy" content="${CSP_PROD}">`,
        `<meta name="referrer" content="strict-origin-when-cross-origin">`,
      ].join('\n    ')
      return html.replace('<head>', `<head>\n    ${metaTags}`)
    },
  }
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
  plugins: [react(), cspMetaPlugin()],
  resolve: {
    alias: {
      '@styles': path.resolve(__dirname, 'src/styles'),
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext",
    },
  },
})

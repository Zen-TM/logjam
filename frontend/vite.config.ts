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
  "img-src 'self' data: blob: https://*.cloudfront.net https://*.s3.ap-southeast-2.amazonaws.com https://tile.openstreetmap.org https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org https://a.tile-cyclosm.openstreetmap.fr https://b.tile-cyclosm.openstreetmap.fr https://c.tile-cyclosm.openstreetmap.fr https://a.tile.opentopomap.org https://b.tile.opentopomap.org https://c.tile.opentopomap.org https://demotiles.maplibre.org https://maps.six.nsw.gov.au https://elevation.fsdf.org.au",
  "font-src 'self' data:",
  "media-src 'self' blob: https://*.cloudfront.net https://*.s3.ap-southeast-2.amazonaws.com",
  "connect-src 'self' https://api.logjamnsw.com https://cognito-idp.ap-southeast-2.amazonaws.com https://*.auth.ap-southeast-2.amazoncognito.com https://*.cloudfront.net https://*.s3.ap-southeast-2.amazonaws.com https://tile.openstreetmap.org https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org https://a.tile-cyclosm.openstreetmap.fr https://b.tile-cyclosm.openstreetmap.fr https://c.tile-cyclosm.openstreetmap.fr https://a.tile.opentopomap.org https://b.tile.opentopomap.org https://c.tile.opentopomap.org https://demotiles.maplibre.org https://maps.six.nsw.gov.au https://elevation.fsdf.org.au",
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

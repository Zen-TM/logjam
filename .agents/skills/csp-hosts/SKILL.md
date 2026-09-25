---
name: csp-hosts
description: How Logjam ships its Content-Security-Policy and other security headers, and the exact checklist for allowlisting a new external host (tile provider, API, image CDN). Use when adding or changing an external host the frontend fetches from, editing CSP_PROD in vite.config.ts or scripts/csp-policy.json, or debugging a "Refused to ..." console violation on production.
---

# CSP and security headers — Logjam frontend

**Hybrid delivery** — custom CloudFront response headers policies are gated behind the AWS Business plan, so:

- **CSP** ships via `<meta http-equiv="Content-Security-Policy">` injected by the `cspMetaPlugin` in `vite.config.ts` at production build time. Source of truth: the `CSP_PROD` constant in `vite.config.ts`. Mirror in `scripts/csp-policy.json`.
- **HSTS / X-Frame-Options / X-Content-Type-Options / Referrer-Policy** ship via the AWS-managed `SecurityHeadersPolicy` attached to the frontend CloudFront distribution. Free, no Business plan required.
- **Dev server has no CSP** — Vite HMR uses inline scripts/eval which would be blocked.

## Adding a new host (tile provider, API, image CDN)

1. Update `CSP_PROD` in `vite.config.ts` (both `img-src` and `connect-src` if it's a fetched-data host).
2. Mirror in `scripts/csp-policy.json`.
3. Rebuild + redeploy frontend.
4. Confirm browser console clean.

**Verification after deploy:** open DevTools console on production site, exercise main features. Any `Refused to ...` CSP violations indicate missing allowlist entries.

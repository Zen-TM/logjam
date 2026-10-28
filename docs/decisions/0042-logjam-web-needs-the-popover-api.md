# 0042. Logjam Web needs the Popover API: Safari 17, Chrome 114, Firefox 125, and a static page below that

- **Date:** 2026-10-29
- **Status:** Accepted
- **Supersedes:** —

## Context

Logjam Web had no written browser floor. On iOS 16.7 (Safari 16.6) it never
loaded: `tip.matches(":popover-open")` in `frontend/src/ui/Tooltip.tsx` and
`useTopLayer` in `frontend/src/ui/Menu.tsx` throws a `SyntaxError` on an engine
without the Popover API, in a layout effect on every mount, so the first
Tooltip or Menu took the tree down to the root error boundary's "Something went
wrong" (#637).

The Popover API (Safari 17, Chrome 114, Firefox 125) is the newest platform
feature Logjam Web relies on. Guarding the one line is not enough: without the
API, `popover="manual"` elements are never hidden, so every tooltip and menu
would show at once.

iOS 16 has a second gap: SIX Maps' certificate chains to DigiCert TLS RSA4096
Root G5, which iOS 16 does not trust, so the SIX base layers fail to load there.

The in-browser GeoPDF renderer (#602) relies on newer features too, such as
`OffscreenCanvas` in workers.

## Decision

- The floor is **Safari 17 (iOS 17), Chrome 114, Firefox 125**.
- `frontend/browser-check.js` runs before the app bundle. Without
  `popover` on `HTMLElement.prototype` it replaces `#root` with one static page
  saying Logjam Web needs a newer browser, and `main.tsx` mounts nothing. It is
  a same-origin classic script, because the production CSP has
  `script-src 'self'` and an engine too old to parse the bundle must still reach
  it.
- The check is by feature, never by user agent.
- `build.target` in `frontend/vite.config.ts` is the floor, so the build agrees
  with it.
- Raising the floor means changing this ADR, `build.target` and the check
  together.
- Guard: `frontend/src/browserCheck.test.ts` (red if the check is removed or
  inverted). Nothing automated holds `build.target` equal to the floor.

## Consequences

- **Positive:** a too-old browser gets a plain sentence, not a crash; a
  contributor may use any feature at or below the floor, and the #602 renderer
  need not handle older engines.
- **Negative:** people on iOS 16 or older (iPhone 8 and earlier cannot update
  past iOS 16) cannot use Logjam Web at all.
- **Neutral:** the page's copy and colours are hand-written in the script, not
  the component kit's.

## Alternatives considered

- **Guard the one line.** Rejected: tooltips and menus would all show at once.
- **Polyfill the Popover API.** Rejected: top-layer behaviour cannot be
  faithfully polyfilled, and it would not fix the SIX gap or the #602 needs.
- **Detect in `main.tsx` or React.** Rejected: an engine that cannot parse the
  bundle never runs it, and the error boundary would see the failure.
- **Match the user agent.** Rejected: spoofable and stale; the feature is what
  matters.

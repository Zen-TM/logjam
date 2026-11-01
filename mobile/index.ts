// App entry. Order matters:
//  1. Polyfills Hermes lacks: crypto.getRandomValues (ids minted on the phone)
//     and URL (shared's endSessionUrl, the map archives' addresses).
//  2. Sentry init (privacy-scrubbed; no-op without a DSN) — before anything
//     that could crash.
//  3. The OIDC provider check — a real-auth build without one fails here, not
//     as an opaque sign-in failure.
import "react-native-get-random-values";
import "react-native-url-polyfill/auto";

import { createElement } from "react";
import { LogBox } from "react-native";
import { registerRootComponent } from "expo";

import { RootErrorBoundary } from "./src/ui/RootErrorBoundary";
import { ThemeProvider } from "./src/theme";
import { initSentry } from "./src/sentry/initSentry";
import { assertOidcConfigured } from "./src/auth/oidcSession";
// Side-effect import: registers the background track-recording task at module
// scope so it exists when Android relaunches the app headless.
import "./src/tracks/trackRecorder";
import App from "./App";

initSentry();
assertOidcConfigured();
// A dev build's error toast covers the tab bar and takes its taps. It hides
// only the toast: Metro and logcat keep the error, and a fatal one still fills
// the screen.
LogBox.ignoreAllLogs();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and sets up the Expo environment appropriately for dev-client and native builds.
// App is wrapped OUTSIDE itself so the boundary also catches throws from App's
// own hooks (min-version gate, auth) — a boundary rendered inside App cannot
// catch the render that mounts it. createElement rather than JSX because this
// entry stays a .ts (package.json "main"). The theme provider is outermost
// because the boundary's own fallback is painted in the scheme.
registerRootComponent(() =>
  createElement(
    ThemeProvider,
    null,
    createElement(RootErrorBoundary, null, createElement(App)),
  ),
);

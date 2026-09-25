// App entry. Order matters:
//  1. Polyfills Amplify needs on Hermes (crypto.getRandomValues, URL).
//  2. Sentry init (privacy-scrubbed; no-op without a DSN) — before anything
//     that could crash.
//  3. Amplify/Cognito config (tokens → SecureStore) — before any auth call.
import "react-native-get-random-values";
import "react-native-url-polyfill/auto";

import { createElement } from "react";
import { registerRootComponent } from "expo";

import { RootErrorBoundary } from "./src/ui/RootErrorBoundary";
import { initSentry } from "./src/sentry/initSentry";
import { configureAmplify } from "./src/auth/amplifyConfig";
// Side-effect import: registers the background track-recording task at module
// scope so it exists when Android relaunches the app headless (Stage 7).
import "./src/tracks/trackRecorder";
import App from "./App";

initSentry();
configureAmplify();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and sets up the Expo environment appropriately for dev-client and native builds.
// App is wrapped OUTSIDE itself so the boundary also catches throws from App's
// own hooks (min-version gate, auth) — a boundary rendered inside App cannot
// catch the render that mounts it. createElement rather than JSX because this
// entry stays a .ts (package.json "main").
registerRootComponent(() =>
  createElement(RootErrorBoundary, null, createElement(App)),
);

// App entry. Order matters:
//  1. Polyfills Amplify needs on Hermes (crypto.getRandomValues, URL).
//  2. Sentry init (privacy-scrubbed; no-op without a DSN) — before anything
//     that could crash.
//  3. Amplify/Cognito config (tokens → SecureStore) — before any auth call.
import "react-native-get-random-values";
import "react-native-url-polyfill/auto";

import { registerRootComponent } from "expo";

import { initSentry } from "./src/sentry/initSentry";
import { configureAmplify } from "./src/auth/amplifyConfig";
import App from "./App";

initSentry();
configureAmplify();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and sets up the Expo environment appropriately for dev-client and native builds.
registerRootComponent(App);

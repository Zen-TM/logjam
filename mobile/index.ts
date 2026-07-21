import { registerRootComponent } from "expo";

import App from "./App";

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and sets up the Expo environment appropriately for dev-client and native builds.
registerRootComponent(App);

// First: shared reads this switch when it loads (src/mainSimRegions.test.ts).
import "./simRegions";
// Second, and loading nothing from shared: see language.ts.
import "./language";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./components/App.tsx";
import { ThemePreferencesProvider } from "./themePreferences";
import { ToastProvider } from "./components/feedback/ToastProvider";
import { RootErrorBoundary } from "./components/feedback/RootErrorBoundary";
import { friendInvite, planInvite } from "./pendingInvite";
import { reconcileLanguage } from "./languageSetting";

// Before anything renders or signs in: see pendingInvite.ts.
friendInvite.capture();
planInvite.capture();

// No #root: browser-check.js replaced it with the "needs a newer
// browser" page. Test: src/browserCheck.test.ts.
const root = document.getElementById("root");
// Before the first render: a browser whose language should differ reloads in it,
// once, and paints nothing in between (languageSetting.ts).
if (root && !reconcileLanguage())
  createRoot(root).render(
    <StrictMode>
      <RootErrorBoundary>
        <ThemePreferencesProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </ThemePreferencesProvider>
      </RootErrorBoundary>
    </StrictMode>,
  );

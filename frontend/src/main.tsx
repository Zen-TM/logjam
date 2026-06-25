import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Amplify } from "aws-amplify";
import "./index.css";
import App from "./components/App.tsx";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import {
  ThemePreferencesProvider,
  useThemePreferences,
} from "./themePreferences";
import { ToastProvider } from "./components/feedback/ToastProvider";
import { RootErrorBoundary } from "./components/feedback/RootErrorBoundary";

if (import.meta.env.VITE_AUTH_MODE !== "fake") {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
        userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
      },
    },
  });
}

function ThemedApp() {
  const { muiTheme } = useThemePreferences();

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ThemePreferencesProvider>
        <ToastProvider>
          <ThemedApp />
        </ToastProvider>
      </ThemePreferencesProvider>
    </RootErrorBoundary>
  </StrictMode>,
);

import {
  createContext,
  useCallback,
  useEffect,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_THEME_SCHEME_ID,
  normalizeUserUiPreferences,
  THEME_SCHEMES,
  THEME_SCHEME_ORDER,
  type ThemeScheme,
  type ThemeSchemeId,
  type ThemeTokens,
} from "@logjam/shared";
import { createThemeFromTokens } from "./theme";
import { fetchCurrentUser, updateCurrentUserThemeScheme } from "./canyonUtils";

function applyTokensToCss(tokens: ThemeTokens) {
  const root = document.documentElement;

  root.style.setProperty("--theme-primary", tokens.primary);
  root.style.setProperty("--theme-secondary", tokens.secondary);
  root.style.setProperty("--theme-accent", tokens.accent);
  root.style.setProperty("--theme-text-primary", tokens.textPrimary);
  root.style.setProperty("--theme-text-muted", tokens.textMuted);
  root.style.setProperty("--theme-warning", tokens.warning);
  root.style.setProperty("--theme-bonus-1", tokens.bonus1);
  root.style.setProperty("--theme-bonus-2", tokens.bonus2);
  root.style.setProperty("--theme-bonus-3", tokens.bonus3);

  // Legacy vars retained so existing CSS modules keep working while migration is in progress.
  root.style.setProperty("--sandstone-dark", tokens.primary);
  root.style.setProperty("--sandstone-light", tokens.secondary);
  root.style.setProperty("--sand-dark", tokens.accent);
  root.style.setProperty("--sand-light", tokens.bonus1);
  root.style.setProperty("--content-color", tokens.textPrimary);

  window.dispatchEvent(new Event("logjam-theme-change"));
}

type ThemePreferencesContextValue = {
  schemeId: ThemeSchemeId;
  schemes: ThemeScheme[];
  isHydrating: boolean;
  isSaving: boolean;
  error: string | null;
  muiTheme: ReturnType<typeof createThemeFromTokens>;
  setThemeScheme: (id: ThemeSchemeId) => Promise<void>;
  hydrateFromUser: () => Promise<void>;
};

const ThemePreferencesContext =
  createContext<ThemePreferencesContextValue | null>(null);

export function ThemePreferencesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [schemeId, setSchemeId] = useState<ThemeSchemeId>(
    DEFAULT_THEME_SCHEME_ID,
  );
  const [isHydrating, setIsHydrating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scheme = THEME_SCHEMES[schemeId];
  const muiTheme = useMemo(
    () => createThemeFromTokens(scheme.tokens),
    [scheme],
  );

  useEffect(() => {
    applyTokensToCss(scheme.tokens);
  }, [scheme]);

  const hydrateFromUser = useCallback(async () => {
    setIsHydrating(true);
    setError(null);

    try {
      const user = await fetchCurrentUser();
      const normalized = normalizeUserUiPreferences(user.uiPreferences);
      setSchemeId(normalized.themeSchemeId);
    } catch {
      // Keep local default when offline or unauthenticated.
    } finally {
      setIsHydrating(false);
    }
  }, []);

  const setThemeScheme = useCallback(
    async (nextId: ThemeSchemeId) => {
      if (nextId === schemeId) return;

      const previous = schemeId;
      setSchemeId(nextId);
      setIsSaving(true);
      setError(null);

      try {
        const updated = await updateCurrentUserThemeScheme(nextId);
        const normalized = normalizeUserUiPreferences(updated.uiPreferences);
        setSchemeId(normalized.themeSchemeId);
      } catch (err) {
        setSchemeId(previous);
        setError(err instanceof Error ? err.message : "Failed to save theme");
      } finally {
        setIsSaving(false);
      }
    },
    [schemeId],
  );

  const value = useMemo<ThemePreferencesContextValue>(
    () => ({
      schemeId,
      schemes: THEME_SCHEME_ORDER.map((id) => THEME_SCHEMES[id]),
      isHydrating,
      isSaving,
      error,
      muiTheme,
      setThemeScheme,
      hydrateFromUser,
    }),
    [
      schemeId,
      isHydrating,
      isSaving,
      error,
      muiTheme,
      setThemeScheme,
      hydrateFromUser,
    ],
  );

  return (
    <ThemePreferencesContext.Provider value={value}>
      {children}
    </ThemePreferencesContext.Provider>
  );
}

export function useThemePreferences() {
  const context = useContext(ThemePreferencesContext);
  if (!context) {
    throw new Error(
      "useThemePreferences must be used inside ThemePreferencesProvider",
    );
  }
  return context;
}

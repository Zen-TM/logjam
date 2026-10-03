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
} from "@logjam/shared";
import { fetchCurrentUser, updateCurrentUserThemeScheme } from "./placeUtils";
import { messageFromError } from "./errors/messageFromError";

/** Every scheme's colours are in tokens.generated.css under
 *  `[data-scheme="<id>"]`; choosing one is setting the attribute. The map
 *  listens for the event to repaint what it reads from those colours. */
function applyScheme(id: ThemeSchemeId) {
  document.documentElement.dataset.scheme = id;
  window.dispatchEvent(new Event("logjam-theme-change"));
}

type ThemePreferencesContextValue = {
  schemeId: ThemeSchemeId;
  schemes: ThemeScheme[];
  isHydrating: boolean;
  isSaving: boolean;
  error: string | null;
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

  useEffect(() => {
    applyScheme(schemeId);
  }, [schemeId]);

  const hydrateFromUser = useCallback(async () => {
    setIsHydrating(true);
    setError(null);

    try {
      const user = await fetchCurrentUser();
      const normalized = normalizeUserUiPreferences(user.uiPreferences);
      setSchemeId(normalized.themeSchemeId);
    } catch (err) {
      // Best-effort: keep the local default theme rather than surface a
      // toast for a background hydration failure — but still log it, or a
      // systematic failure (e.g. a 500 on /users/me) is invisible (FECO-011).
      console.error(err);
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
        console.error(err);
        setSchemeId(previous);
        setError(
          messageFromError(err, "Couldn't save theme. Please try again."),
        );
      } finally {
        setIsSaving(false);
      }
    },
    [schemeId],
  );

  const value = useMemo<ThemePreferencesContextValue>(
    () => ({
      schemeId,
      schemes: THEME_SCHEME_ORDER.map((id: ThemeSchemeId) => THEME_SCHEMES[id]),
      isHydrating,
      isSaving,
      error,
      setThemeScheme,
      hydrateFromUser,
    }),
    [schemeId, isHydrating, isSaving, error, setThemeScheme, hydrateFromUser],
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

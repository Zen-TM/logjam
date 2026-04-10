import { DEFAULT_THEME_SCHEME_ID, THEME_SCHEMES } from "@logjam/shared";
import { useThemePreferences } from "../../../themePreferences";
import classes from "./SettingsPanel.module.css";

function SettingsPanel() {
  const { schemeId, schemes, isHydrating, isSaving, error, setThemeScheme } =
    useThemePreferences();

  return (
    <div className={classes.root}>
      <p className={classes.description}>
        Pick a palette for the app UI and map styling.
      </p>

      {error && <p className={classes.error}>{error}</p>}

      {isHydrating && (
        <p className={classes.state}>Loading your saved theme...</p>
      )}
      {isSaving && <p className={classes.state}>Saving theme...</p>}

      {schemes.map((scheme) => {
        const isSelected = scheme.id === schemeId;
        const cardClass = `${classes.card} ${isSelected ? classes.cardSelected : ""}`;

        return (
          <button
            key={scheme.id}
            type="button"
            className={cardClass}
            onClick={() => setThemeScheme(scheme.id)}
            disabled={isSaving}
            aria-pressed={isSelected}
          >
            <div className={classes.cardHeader}>
              <h3 className={classes.cardName}>{scheme.name}</h3>
              <div className={classes.swatches}>
                {[
                  scheme.tokens.primary,
                  scheme.tokens.secondary,
                  scheme.tokens.accent,
                ].map((color) => (
                  <span
                    key={color}
                    className={classes.swatch}
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                ))}
              </div>
            </div>
            {scheme.description && (
              <p className={classes.cardHint}>{scheme.description}</p>
            )}
          </button>
        );
      })}

      <button
        type="button"
        className={classes.resetButton}
        disabled={isSaving || schemeId === DEFAULT_THEME_SCHEME_ID}
        onClick={() => setThemeScheme(DEFAULT_THEME_SCHEME_ID)}
      >
        Reset to {THEME_SCHEMES[DEFAULT_THEME_SCHEME_ID].name}
      </button>
    </div>
  );
}

export default SettingsPanel;

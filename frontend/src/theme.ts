import { createTheme } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";
import type { ThemeTokens } from "@logjam/shared";

export function createThemeFromTokens(tokens: ThemeTokens): Theme {
  return createTheme({
    palette: {
      primary: {
        main: tokens.accent,
      },
      secondary: {
        main: tokens.secondary,
      },
      warning: {
        main: tokens.warning,
      },
      text: {
        primary: tokens.textPrimary,
        secondary: tokens.textMuted,
      },
    },
    components: {
      MuiTextField: {
        styleOverrides: {
          root: {
            input: {
              color: "var(--text-primary)",
              "&::placeholder": {
                color: "var(--text-muted)",
              },
            },
            "& .MuiInputLabel-root": {
              color: "var(--text-primary)",
            },
            label: {
              color: "var(--text-primary)",
            },
            "& .MuiOutlinedInput-root": {
              "& fieldset": {
                borderColor: "var(--text-muted)",
              },
              "&:hover:not(.Mui-focused) fieldset": {
                borderColor: "var(--text-muted)",
              },
            },
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          root: {
            color: "var(--text-primary)",
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: "var(--text-muted)",
            },
            "&:hover:not(.Mui-focused) .MuiOutlinedInput-notchedOutline": {
              borderColor: "var(--text-muted)",
            },
          },
          icon: {
            color: "var(--text-primary)",
          },
        },
      },
    },
  });
}

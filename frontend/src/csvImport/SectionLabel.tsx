import { Typography } from "@mui/material";

/**
 * Uppercase caption heading for a group of dialog fields.
 *
 * Lives here rather than in `dialogStyles.tsx` so that file stays a pure
 * styles module: a file that exports both a component and shared constants
 * breaks Fast Refresh (react-refresh/only-export-components), which is why
 * every sx object exported alongside it warned.
 */
export function SectionLabel({ text }: { text: string }) {
  return (
    <Typography
      variant="caption"
      sx={{
        color: "var(--theme-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        fontWeight: 600,
        fontSize: "0.7em",
      }}
    >
      {text}
    </Typography>
  );
}

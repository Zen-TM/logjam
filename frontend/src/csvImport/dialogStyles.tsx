import { Typography } from "@mui/material";

export const fieldSx = {
  "& .MuiInputBase-input": { color: "var(--theme-text-primary)", fontSize: "0.9em" },
  "& .MuiInputLabel-root": { color: "var(--theme-text-muted)" },
  "& .MuiInputLabel-root.Mui-focused": { color: "var(--theme-accent)" },
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
};

export const selectSx = {
  color: "var(--theme-text-primary)",
  fontSize: "0.85em",
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
  "& .MuiSvgIcon-root": { color: "var(--theme-text-muted)" },
};

export const menuPaperProps = {
  PaperProps: {
    sx: { backgroundColor: "var(--theme-primary)", color: "var(--theme-text-primary)" },
  },
};

// High-contrast filled chip for trip-type tags — same accent-fill/dark-label
// system as .btnFilledAccent in styles/shared.module.css (accent is tuned
// light enough that the dark primary is the AA-readable label on it, in every
// theme scheme). Visually distinct from default-grey canyon chips. Used by
// TripLogDialog (selected-type chips) and TripLogViewDialog; the trip cards
// in TripLogsPanel mirror it in CSS (.typeChip).
export const typeChipSx = {
  backgroundColor: "var(--theme-accent)",
  color: "var(--theme-primary)",
  fontWeight: 600,
  "& .MuiChip-deleteIcon": { color: "var(--theme-primary)", opacity: 0.6 },
  "& .MuiChip-deleteIcon:hover": { color: "var(--theme-primary)", opacity: 1 },
} as const;

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

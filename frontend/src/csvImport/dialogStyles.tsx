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

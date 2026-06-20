import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Button,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import classes from "./ImportResultSummary.module.css";

// ── Types ──────────────────────────────────────────────────────────────────────

/** A single tally shown in the headline (e.g. "271 merged"). */
export type HeadlineCount = {
  count: number;
  label: string;
};

/** A named section of detail lines behind the disclosure. */
export type DetailSection = {
  title: string;
  items: string[];
};

export type ImportResultSummaryProps = {
  /** Always-visible headline tallies (e.g. imported, linked, created, skipped). */
  headline: HeadlineCount[];

  /** Optional detail sections shown inside the MUI Accordion disclosure. */
  details?: DetailSection[];

  /** Errors that occurred during import (always shown, not behind disclosure). */
  errors?: string[];

  /** When provided, renders an "Undo this import" button and calls back on click. */
  onUndo?: () => void;

  /** Whether the undo action is currently in progress. */
  undoing?: boolean;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildHeadlineText(headline: HeadlineCount[]): string {
  const parts = headline
    .filter((h) => h.count > 0)
    .map((h) => `${h.count} ${h.label}`);
  if (parts.length === 0) return "No changes made.";
  return parts.join(", ") + ".";
}

// ── Component ──────────────────────────────────────────────────────────────────

function ImportResultSummary({
  headline,
  details,
  errors,
  onUndo,
  undoing,
}: ImportResultSummaryProps): React.JSX.Element {
  const hasDetails = details !== undefined && details.some((s) => s.items.length > 0);
  const hasErrors = errors !== undefined && errors.length > 0;

  return (
    <div className={classes.container}>
      <Typography className={classes.headline}>
        {buildHeadlineText(headline)}
      </Typography>

      {hasErrors && (
        <ul className={`${classes.detailList} ${classes.errorList}`}>
          {errors!.map((errMsg, i) => (
            <li key={i} className={classes.detailItem}>
              <span className={classes.detailBullet} />
              <span>{errMsg}</span>
            </li>
          ))}
        </ul>
      )}

      {hasDetails && (
        <Accordion
          sx={{
            backgroundColor: "rgba(255,255,255,0.04)",
            color: "var(--theme-text-primary)",
            "& .MuiAccordionSummary-root": { minHeight: 40 },
          }}
        >
          <AccordionSummary
            expandIcon={
              <ExpandMoreIcon sx={{ color: "var(--theme-text-primary)" }} />
            }
          >
            <Typography variant="body2">Details</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            {details!.map((section) => {
              if (section.items.length === 0) return null;
              return (
                <div key={section.title} style={{ marginBottom: 12 }}>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "var(--theme-text-muted)",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {section.title}
                  </Typography>
                  <ul className={classes.detailList}>
                    {section.items.map((item, i) => (
                      <li key={i} className={classes.detailItem}>
                        <span className={classes.detailBullet} />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </AccordionDetails>
        </Accordion>
      )}

      {onUndo && (
        <Button
          variant="outlined"
          color="error"
          size="small"
          onClick={onUndo}
          disabled={undoing}
          sx={{ alignSelf: "flex-start", textTransform: "none" }}
        >
          {undoing ? "Undoing..." : "Undo this import"}
        </Button>
      )}
    </div>
  );
}

export default ImportResultSummary;

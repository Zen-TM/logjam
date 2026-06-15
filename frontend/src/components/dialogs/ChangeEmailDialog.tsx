import { useState } from "react";
import { useIsMobile } from "../../useIsMobile";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  TextField,
  Typography,
  CircularProgress,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { updateUserAttribute, confirmUserAttribute } from "aws-amplify/auth";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";

const inputSx = {
  "& .MuiInputBase-input": { color: "var(--theme-text-primary)" },
  "& .MuiInputLabel-root": { color: "var(--theme-text-muted)" },
  "& .MuiInputLabel-root.Mui-focused": { color: "var(--theme-accent)" },
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "rgba(255,255,255,0.3)" },
  "& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline": {
    borderColor: "rgba(255,255,255,0.5)",
  },
  "& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline": {
    borderColor: "var(--theme-accent)",
  },
};

type Stage = "input" | "verify" | "done";

function ChangeEmailDialog({
  open,
  onClose,
  onSuccess,
  currentEmail = "",
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (newEmail: string) => void;
  currentEmail?: string;
}) {
  const isMobile = useIsMobile();
  const [stage, setStage] = useState<Stage>("input");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Captured at send-code time so the verify screen can display it
  const [pendingEmail, setPendingEmail] = useState("");

  function handleClose() {
    if (loading) return;
    setStage("input");
    setNewEmail("");
    setCode("");
    setError(null);
    onClose();
  }

  async function handleSendCode() {
    const trimmed = newEmail.trim();
    if (!trimmed) return;
    if (currentEmail && trimmed.toLowerCase() === currentEmail.toLowerCase()) {
      setError("That's already your current email address.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await updateUserAttribute({
        userAttribute: { attributeKey: "email", value: trimmed },
      });
      setPendingEmail(trimmed);
      setStage("verify");
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't send verification code. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setLoading(true);
    setError(null);
    try {
      await updateUserAttribute({
        userAttribute: { attributeKey: "email", value: pendingEmail },
      });
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't resend verification code. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    const trimmedCode = code.trim();
    if (!trimmedCode) return;
    setLoading(true);
    setError(null);
    try {
      await confirmUserAttribute({ userAttributeKey: "email", confirmationCode: trimmedCode });
      setStage("done");
      onSuccess(pendingEmail);
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Incorrect or expired code. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  const titles: Record<Stage, string> = {
    input: "Change email",
    verify: "Verify new email",
    done: "Email updated",
  };

  return (
    <Dialog
      fullScreen={isMobile}
      open={open}
      maxWidth="sm"
      fullWidth
      onClose={handleClose}
      PaperProps={{
        sx: { backgroundColor: "var(--theme-primary)", color: "var(--theme-text-primary)" },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pb: 1,
        }}
      >
        {titles[stage]}
        <IconButton
          size="small"
          onClick={handleClose}
          disabled={loading}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent
        dividers
        sx={{ borderColor: "rgba(255,255,255,0.1)", display: "flex", flexDirection: "column", gap: 2 }}
      >
        {stage === "input" && (
          <>
            <Typography sx={{ color: "var(--theme-text-muted)", fontSize: "var(--text-sm)" }}>
              Enter your new email address. A verification code will be sent to it.
            </Typography>
            <TextField
              label="New email"
              type="email"
              size="small"
              fullWidth
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSendCode(); }}
              disabled={loading}
              autoFocus
              sx={inputSx}
            />
          </>
        )}
        {stage === "verify" && (
          <>
            <Typography sx={{ color: "var(--theme-text-muted)", fontSize: "var(--text-sm)" }}>
              A verification code was sent to{" "}
              <strong style={{ color: "var(--theme-text-primary)" }}>{pendingEmail}</strong> (check spam).
              Enter it below.
            </Typography>
            <TextField
              label="Verification code"
              size="small"
              fullWidth
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
              disabled={loading}
              autoFocus
              inputProps={{ maxLength: 10 }}
              sx={inputSx}
            />
          </>
        )}
        {stage === "done" && (
          <Typography sx={{ color: "var(--theme-text-primary)", fontSize: "var(--text-sm)" }}>
            Your email has been updated to{" "}
            <strong>{pendingEmail}</strong>. Use it to sign in next time.
          </Typography>
        )}
        {error && <ErrorBanner message={error} />}
      </DialogContent>
      <DialogActions>
        {stage === "done" ? (
          <Button onClick={handleClose} sx={{ color: "var(--theme-text-primary)" }}>
            Close
          </Button>
        ) : (
          <>
            <Button
              onClick={handleClose}
              disabled={loading}
              sx={{ color: "var(--theme-text-primary)" }}
            >
              Cancel
            </Button>
            {stage === "input" && (
              <Button
                variant="contained"
                color="secondary"
                disabled={!newEmail.trim() || loading}
                onClick={handleSendCode}
                startIcon={loading ? <CircularProgress size={14} color="inherit" /> : undefined}
              >
                {loading ? "Sending…" : "Send code"}
              </Button>
            )}
            {stage === "verify" && (
              <>
                <Button
                  onClick={handleResend}
                  disabled={loading}
                  sx={{ color: "var(--theme-text-muted)" }}
                >
                  Resend code
                </Button>
                <Button
                  variant="contained"
                  color="secondary"
                  disabled={!code.trim() || loading}
                  onClick={handleConfirm}
                  startIcon={loading ? <CircularProgress size={14} color="inherit" /> : undefined}
                >
                  {loading ? "Confirming…" : "Confirm"}
                </Button>
              </>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default ChangeEmailDialog;

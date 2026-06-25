import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Alert, Snackbar, Stack } from "@mui/material";

type Severity = "error" | "success" | "info" | "warning";

type Toast = {
  id: number;
  message: string;
  severity: Severity;
};

type ToastContextValue = {
  error: (message: string) => void;
  success: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;
const MAX_TOASTS = 3;
const AUTO_HIDE_MS = 6000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, severity: Severity) => {
    setToasts((prev) => {
      const next = [...prev, { id: nextId++, message, severity }];
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    });
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Memoize the context value: a fresh object literal each render gives every
  // useToast() consumer a new `toast` identity on every render. Effects that
  // list `toast` in their deps (e.g. App.tsx's error toasts + the user
  // hydration fetch) then re-run on each render — and since pushing a toast
  // re-renders this provider, a single failing fetch + toast becomes an
  // infinite fetch/render loop (React #185 + a request flood). `push` is
  // stable, so the memo only ever recomputes once.
  const value = useMemo<ToastContextValue>(
    () => ({
      error: (m) => push(m, "error"),
      success: (m) => push(m, "success"),
      info: (m) => push(m, "info"),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Stack
        spacing={1}
        sx={{ position: "fixed", bottom: 24, right: 24, zIndex: 2000, pointerEvents: "none" }}
      >
        {toasts.map((t) => (
          <Snackbar
            key={t.id}
            open
            autoHideDuration={AUTO_HIDE_MS}
            onClose={() => dismiss(t.id)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            sx={{ position: "relative", bottom: "auto", right: "auto", pointerEvents: "all" }}
          >
            <Alert
              severity={t.severity}
              variant="filled"
              onClose={() => dismiss(t.id)}
              sx={{ minWidth: 260, maxWidth: 400 }}
            >
              {t.message}
            </Alert>
          </Snackbar>
        ))}
      </Stack>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

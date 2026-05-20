import { AlertTriangle } from "lucide-react";
import classes from "./ErrorBanner.module.css";

type Props = {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
};

export function ErrorBanner({ message, onRetry, onDismiss }: Props) {
  return (
    <div className={classes.banner} role="alert">
      <AlertTriangle size={14} className={classes.icon} />
      <div className={classes.content}>
        {message}
        {(onRetry || onDismiss) && (
          <div className={classes.actions}>
            {onRetry && (
              <button className={classes.retryBtn} onClick={onRetry} type="button">
                Try again
              </button>
            )}
            {onDismiss && (
              <button className={classes.dismissBtn} onClick={onDismiss} type="button">
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

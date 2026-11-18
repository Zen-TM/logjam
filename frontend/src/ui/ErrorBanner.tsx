import classes from "./ErrorBanner.module.css";
import { Icon } from "./Icon";
import { t } from "@logjam/shared";

type Props = {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
};

export function ErrorBanner({ message, onRetry, onDismiss }: Props) {
  return (
    <div className={classes.banner} role="alert">
      <Icon idea="warning" size={14} className={classes.icon} />
      <div className={classes.content}>
        {message}
        {(onRetry || onDismiss) && (
          <div className={classes.actions}>
            {onRetry && (
              <button
                className={classes.retryBtn}
                onClick={onRetry}
                type="button"
              >{t`Try again`}</button>
            )}
            {onDismiss && (
              <button
                className={classes.dismissBtn}
                onClick={onDismiss}
                type="button"
              >{t`Dismiss`}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

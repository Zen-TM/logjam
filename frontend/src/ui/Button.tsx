import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import classes from "./Button.module.css";
import { Icon, type Glyph } from "./Icon";

type ButtonVariant = "filled" | "outline" | "danger" | "destructive" | "plain";

/**
 * A text button. Pill-shaped, as on Logjam GPS. `filled` is the ONE primary
 * action in its surface; `outline` a secondary; `danger` a destructive verb;
 * `destructive` the primary of a destructive confirm; `plain` a cancel.
 * `compact` is the `--control-md` size for headers, bars and sheets. `busy`
 * swaps the leading glyph for a spinner and disables the button while its
 * request runs.
 */
export function Button({
  variant = "plain",
  compact = false,
  busy = false,
  disabled,
  icon,
  trailingIcon,
  children,
  className,
  ref,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  compact?: boolean;
  busy?: boolean;
  icon?: Glyph;
  trailingIcon?: Glyph;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}) {
  const glyph = compact ? 14 : 16;
  return (
    <button
      ref={ref}
      type={type}
      className={[
        classes.button,
        classes[variant],
        compact && classes.compact,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? (
        <Icon idea="loading" size={glyph} className={classes.spinner} />
      ) : (
        icon && <Icon idea={icon} size={glyph} />
      )}
      {children}
      {trailingIcon && <Icon idea={trailingIcon} size={glyph} />}
    </button>
  );
}

const ICON_TONE_CLASS = {
  filled: "tinted",
  danger: "danger",
  onInverse: "onInverse",
} as const;

/**
 * An icon-only button. `label` is REQUIRED: it is the accessible name and the
 * mouse tooltip, because an icon has neither. `filled` marks a control whose
 * state is "on" (a search with a query, filters that are active).
 */
export function IconButton({
  icon,
  label,
  tone = "default",
  size = 18,
  round = false,
  className,
  ref,
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  icon: Glyph;
  label: string;
  tone?: "default" | "filled" | "danger" | "onInverse";
  size?: number;
  /** At the end of a pill (a toast, a strip, a notice): a `--control-sm`
   *  circle. The host pads that end by (its height − that) / 2, so the circle
   *  is concentric with the pill's end and neither hover nor focus crosses its
   *  edge. */
  round?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={[
        classes.iconButton,
        tone !== "default" && classes[ICON_TONE_CLASS[tone]],
        round && classes.round,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <Icon idea={icon} size={size} />
    </button>
  );
}

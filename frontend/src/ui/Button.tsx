import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import type { LucideIcon } from "lucide-react";
import classes from "./Button.module.css";

type ButtonVariant = "filled" | "outline" | "danger" | "plain";

/**
 * A text button. Pill-shaped, as on Logjam GPS. `filled` is the ONE primary
 * action in its surface; `outline` a secondary; `danger` a destructive verb;
 * `plain` a cancel. `compact` is the `--control-md` size for headers, bars and
 * sheets.
 */
export function Button({
  variant = "plain",
  compact = false,
  icon: Icon,
  trailingIcon: TrailingIcon,
  children,
  className,
  ref,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  compact?: boolean;
  icon?: LucideIcon;
  trailingIcon?: LucideIcon;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}) {
  const glyph = compact ? 14 : 16;
  return (
    <button
      ref={ref}
      type={type}
      className={[classes.button, classes[variant], compact && classes.compact, className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {Icon && <Icon size={glyph} aria-hidden />}
      {children}
      {TrailingIcon && <TrailingIcon size={glyph} aria-hidden />}
    </button>
  );
}

const ICON_TONE_CLASS = { filled: "tinted", danger: "danger", onFill: "onFill" } as const;

/**
 * An icon-only button. `label` is REQUIRED: it is the accessible name and the
 * mouse tooltip, because an icon has neither. `filled` marks a control whose
 * state is "on" (a search with a query, filters that are active).
 */
export function IconButton({
  icon: Icon,
  label,
  tone = "default",
  size = 18,
  round = false,
  className,
  ref,
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  icon: LucideIcon;
  label: string;
  tone?: "default" | "filled" | "danger" | "onFill";
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
      <Icon size={size} aria-hidden />
    </button>
  );
}

import classes from "./FieldError.module.css";
import { Icon } from "./Icon";

type Props = { message: string | null; id?: string };

/**
 * The one inline validation line (UX §11): directly under the control it is
 * about. The words are `text` and a warning glyph leads them, because words are
 * never an intent colour (UX §7); the same shape as Logjam GPS's `FieldError`.
 * Null renders nothing.
 */
export function FieldError({ message, id }: Props) {
  if (!message) return null;
  return (
    <p id={id} className={classes.error} role="alert">
      <Icon idea="warning" size={14} className={classes.glyph} />
      <span>{message}</span>
    </p>
  );
}

import classes from "./FieldError.module.css";
import { Icon } from "./Icon";

type Props = {
  message: string | null;
  id?: string;
  /** Keeps the line's height while there is no message, so a form whose
   *  submit lights its errors does not shift under the pointer. */
  reserve?: boolean;
};

/**
 * The one inline validation line (UX §11): directly under the control it is
 * about. The words are `text` and a warning glyph leads them, because words are
 * never an intent colour (UX §7); the same shape as Logjam GPS's `FieldError`.
 * Null renders nothing, or an empty line of the same height with `reserve`.
 */
export function FieldError({ message, id, reserve = false }: Props) {
  if (!message) {
    return reserve ? <div className={classes.reserved} aria-hidden /> : null;
  }
  return (
    <p id={id} className={classes.error} role="alert">
      <Icon idea="warning" size={14} className={classes.glyph} />
      <span>{message}</span>
    </p>
  );
}

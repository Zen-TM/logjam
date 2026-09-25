import classes from "./FieldError.module.css";

type Props = { message: string | null; id?: string };

export function FieldError({ message, id }: Props) {
  if (!message) return null;
  return (
    <p id={id} className={classes.error} role="alert">
      {message}
    </p>
  );
}

import classes from "./FieldError.module.css";

type Props = { message: string | null };

export function FieldError({ message }: Props) {
  if (!message) return null;
  return <p className={classes.error} role="alert">{message}</p>;
}

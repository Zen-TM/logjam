import { useState } from "react";
import { TextField, Button } from "@mui/material";
import classes from "./SignIn.module.css";

function SignIn({
  onSignIn,
  error,
}: {
  onSignIn: (username: string, password: string) => Promise<void>;
  error: string | null;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await onSignIn(username, password);
    setSubmitting(false);
  }

  return (
    <div className={classes.container}>
      <form className={classes.form} onSubmit={handleSubmit}>
        <h1 className={classes.title}>Logjam</h1>
        <TextField
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          size="small"
          fullWidth
          required
          autoFocus
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          size="small"
          fullWidth
          required
        />
        {error && <p className={classes.error}>{error}</p>}
        <Button
          type="submit"
          variant="contained"
          fullWidth
          disabled={submitting}
        >
          {submitting ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </div>
  );
}

export default SignIn;

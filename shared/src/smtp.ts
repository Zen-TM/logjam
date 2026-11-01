// The email config the API (api/src/services/email.ts) and the topo workers
// (topo/email_send.py) read. A sender with any of these unset skips the send.
// Guard that topo reads the same names: topo/tests/test_email_send.py.
export const SMTP_ENV_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "EMAIL_FROM",
] as const;

// Base64 PEM of the only CA to trust in place of the public roots. Local dev
// sets it for Mailpit's certificate (infra/mailpit); prod leaves it unset.
export const SMTP_CA_ENV_KEY = "SMTP_CA_CERT";

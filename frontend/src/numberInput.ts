// Keystroke-level sanitizers for numeric text inputs. We render numeric fields
// as type="text" (with inputMode) and route every onChange through these so the
// input can never hold a value that breaks its format: letters are rejected
// everywhere, and a decimal point is rejected in integer fields. Returning the
// sanitized string from onChange means an illegal keystroke is simply dropped
// (the input value doesn't change), without onKeyDown handling (covers paste/IME).

/** Allow an optional leading minus and digits only. */
export function sanitizeIntegerInput(raw: string): string {
  if (raw === "") return "";
  const negative = raw.startsWith("-");
  const digits = (negative ? raw.slice(1) : raw).replace(/[^0-9]/g, "");
  return (negative ? "-" : "") + digits;
}

/** Allow an optional leading minus, digits, and a single decimal point. */
export function sanitizeDecimalInput(raw: string): string {
  if (raw === "") return "";
  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  // Keep digits and dots, then collapse to at most one dot (the first one).
  const cleaned = body.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  const normalized =
    firstDot === -1
      ? cleaned
      : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
  return (negative ? "-" : "") + normalized;
}

/** Pick the sanitizer for a numeric custom-field type. */
export function sanitizeNumericInput(
  raw: string,
  type: "integer" | "float",
): string {
  return type === "integer"
    ? sanitizeIntegerInput(raw)
    : sanitizeDecimalInput(raw);
}

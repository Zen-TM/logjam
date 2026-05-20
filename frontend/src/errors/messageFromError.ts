import { ApiError } from "./ApiError";
import { mapAuthError } from "./authErrorMap";

const STATUS_MESSAGES: Record<number, string> = {
  401: "You're not authorised to do that. Please sign in and try again.",
  403: "You don't have permission to do that.",
  404: "The requested item could not be found.",
  409: undefined as unknown as string, // let serverMessage win for 409 (domain-specific conflicts)
  429: "Too many requests. Please wait a moment and try again.",
  500: "Something went wrong on the server. Please try again.",
  503: "The server is temporarily unavailable. Please try again shortly.",
};

export function messageFromError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.serverMessage) return err.serverMessage;
    const statusMsg = STATUS_MESSAGES[err.status];
    if (statusMsg) return statusMsg;
    if (err.status >= 500) return "Something went wrong on the server. Please try again.";
    if (err.status >= 400) return fallback;
  }

  const authMsg = mapAuthError(err);
  if (authMsg) return authMsg;

  if (err instanceof Error && err.message === "Network Error") {
    return "Couldn't reach the server. Please check your connection and try again.";
  }
  if (err instanceof TypeError && err.message.includes("fetch")) {
    return "Couldn't reach the server. Please check your connection and try again.";
  }

  return fallback;
}

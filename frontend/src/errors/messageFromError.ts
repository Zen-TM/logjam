// Thin re-export — canonical implementation lives in shared/src/apiErrors.ts
// (tests there too) so web and mobile can never diverge on error semantics.
export { messageFromError } from "@logjam/shared";

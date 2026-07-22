// Thin re-export — canonical implementation lives in shared/src/apiErrors.ts
// so web and mobile share one Cognito error/next-step mapping.
export { mapAuthError, mapAuthNextStep } from "@logjam/shared";

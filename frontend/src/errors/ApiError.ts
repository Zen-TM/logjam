// Thin re-export — ApiError lives in shared/src/apiErrors.ts so web and mobile
// share one class identity (messageFromError branches on instanceof).
export { ApiError } from "@logjam/shared";

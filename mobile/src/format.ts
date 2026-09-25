// Display formatters shared across screens. Not in `src/ui` — that is the
// component kit, and a string function is not a component.
//
// Sizes and durations are declared once in `@logjam/shared` (Logjam Web says
// them too) and re-exported here so the screens keep one import.
export { formatBytes, formatMinutes } from "@logjam/shared";


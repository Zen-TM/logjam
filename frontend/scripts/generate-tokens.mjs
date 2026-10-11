// Writes src/tokens.generated.css from the shared declarations. Run after
// changing @logjam/shared's designTokens.ts or themeSchemes.ts (and `make
// shared`); src/tokens.generated.test.ts fails until you do.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { webTokensCss } from "@logjam/shared";

const out = fileURLToPath(
  new URL("../src/tokens.generated.css", import.meta.url),
);
writeFileSync(out, webTokensCss());
console.log(`wrote ${out}`);

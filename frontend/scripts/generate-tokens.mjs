// Writes src/tokens.generated.css and src/textRoles.generated.module.css from
// the shared declarations. Run after changing @logjam/shared's designTokens.ts
// or themeSchemes.ts (and `make shared`); src/tokens.generated.test.ts fails
// until you do.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { webTextRolesCss, webTokensCss } from "@logjam/shared";

for (const [file, css] of [
  ["../src/tokens.generated.css", webTokensCss()],
  ["../src/textRoles.generated.module.css", webTextRolesCss()],
]) {
  const out = fileURLToPath(new URL(file, import.meta.url));
  writeFileSync(out, css);
  console.log(`wrote ${out}`);
}

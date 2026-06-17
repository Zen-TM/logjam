// One-off axe-core accessibility smoke test against the local dev app (fake auth
// boots straight to the map). Runs axe on the map view and with the Canyons panel
// + a dialog open. Structural a11y is scheme-independent; per-scheme contrast is
// proven separately by scripts/wcag-contrast.mjs. Throwaway verification aid.
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";

function summarize(label, results) {
  const serious = results.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact),
  );
  console.log(`\n=== ${label}: ${results.violations.length} violations (${serious.length} serious/critical) ===`);
  for (const v of results.violations) {
    console.log(`  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`);
  }
  return serious.length;
}

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext();
const page = await context.newPage();
let seriousTotal = 0;
try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  seriousTotal += summarize("Map view (default scheme)", await new AxeBuilder({ page }).analyze());

  // Open the Canyons panel via its nav-rail button (aria-label set on NavRail items).
  const canyonsBtn = page.getByRole("button", { name: /canyon/i }).first();
  if (await canyonsBtn.count()) {
    await canyonsBtn.click();
    await page.waitForTimeout(600);
    seriousTotal += summarize("Canyons panel open", await new AxeBuilder({ page }).analyze());
  }
} finally {
  await browser.close();
}
console.log(`\n${seriousTotal === 0 ? "✓ no serious/critical violations" : `✗ ${seriousTotal} serious/critical`}`);
process.exit(seriousTotal === 0 ? 0 : 1);

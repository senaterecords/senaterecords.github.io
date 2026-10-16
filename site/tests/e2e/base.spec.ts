import { expect, test } from "@playwright/test";

test.skip(!process.env.SITE_BASE || process.env.SITE_BASE === "/", "run with SITE_BASE=/ontherecord/");

test("everything works under a project path", async ({ page }) => {
  const missing: string[] = [];
  page.on("response", (r) => { if (r.status() === 404) missing.push(r.url()); });
  for (const path of ["./", "transcripts/2025-03-04-regular-session/", "senators/liz-krueger/", "bills/2009/S50025/", "search/?q=budget"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  await expect(page.locator("[data-result]").first()).toBeVisible();
  // Result links are built from the index, which knows nothing of the base path.
  await expect(page.locator("[data-result] a.ctx").first()).toHaveAttribute("href", new RegExp(`^${process.env.SITE_BASE}transcripts/`));
  expect(missing).toEqual([]);
});

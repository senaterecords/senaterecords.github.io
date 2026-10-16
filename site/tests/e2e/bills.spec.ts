import { expect, test } from "@playwright/test";

test("the bills list filters by number and debate", async ({ page }) => {
  await page.goto("bills/2025/");
  const rows = page.locator("[data-bill-row]");
  const all = await rows.count();
  expect(all).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Debated", exact: true }).click();
  expect(await rows.filter({ visible: true }).count()).toBeLessThanOrEqual(all);
  await page.getByRole("searchbox", { name: /Find a bill/ }).fill("zzzz-no-such-bill");
  await expect(rows.filter({ visible: true })).toHaveCount(0);
});

test("a bill page shows the debate, the vote and who spoke", async ({ page }) => {
  await page.goto("bills/2025/");
  await page.getByRole("button", { name: "Debated", exact: true }).click();
  await page.locator("[data-bill-row]:visible a").first().click();
  await expect(page.getByRole("heading", { name: "The floor debate" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Read the debate" })).toHaveAttribute("href", /transcripts\/.+#r-\d+$/);
});

test("a special-session bill links back to its reading", async ({ page }) => {
  await page.goto("bills/2009/S50025/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('a[href*="2009-06-23-extraordinary-session"]').first()).toBeVisible();
});

test("a bill from before 2009 says details aren't available", async ({ page }) => {
  await page.goto("transcripts/1995-05-08-regular-session/");
  const href = await page.locator('a[href*="/bills/1995/"]').first().getAttribute("href");
  await page.goto(href!.replace(/^.*?bills\//, "bills/"));
  await expect(page.getByText("Full details not available for bills before 2009")).toBeVisible();
});

test("the bill index serves bill suggestions", async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}data/bill-index/S50.json`);
  expect(response.ok()).toBe(true);
  const rows = await response.json();
  expect(rows.some((r: { printNo: string }) => r.printNo.startsWith("S50025"))).toBe(true);
});

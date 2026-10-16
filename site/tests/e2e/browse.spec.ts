import { expect, test } from "@playwright/test";

test("browse opens a year grouped by month", async ({ page }) => {
  await page.goto("browse/2025/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("2025 transcripts");
  await expect(page.getByRole("heading", { name: /^March 2025/ })).toBeVisible();
  await page.getByRole("link", { name: "1995", exact: true }).click();
  await expect(page).toHaveURL(/browse\/1995\//);
});

test("the About page says where the data comes from, with no quality numbers", async ({ page }) => {
  await page.goto("about/");
  await expect(page.getByText(/Open Legislation API/)).toBeVisible();
  await expect(page.getByText("The archive")).toBeVisible();
  await expect(page.getByText(/%/)).toHaveCount(0);
});

test("legislative days stay out of a year's list until asked for, and the choice is remembered", async ({ page }) => {
  await page.goto("browse/2023/");
  const day = page.locator("ul.tr li.ld").first();
  await expect(day).toBeHidden();
  // The switch sits in the year's summary, where the count already is.
  const meta = page.locator(".pg-meta");
  await expect(meta).toContainText("1 legislative day hidden · Show", { useInnerText: true });
  await meta.getByText("Show", { exact: true }).click();
  await expect(meta).toContainText("1 legislative day · Hide", { useInnerText: true });
  await expect(day).toBeVisible();
  // A month's count is what it shows.
  await expect(page.locator(".mg", { has: day }).locator(".sec-h2 span")).toHaveText("1 transcript");
  await page.reload();
  await expect(day).toBeVisible();
});

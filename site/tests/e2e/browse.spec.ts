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
  await expect(page.locator(".pg-meta")).toContainText("1 legislative day");
  await page.getByLabel("Show 1 legislative day").check();
  await expect(day).toBeVisible();
  await page.reload();
  await expect(day).toBeVisible();
});

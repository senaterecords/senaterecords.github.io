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

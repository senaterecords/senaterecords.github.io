import { expect, test } from "@playwright/test";

test("browse opens a year grouped by month", async ({ page }) => {
  await page.goto("browse/2025/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("2025 transcripts");
  await expect(page.getByRole("heading", { name: /^March 2025/ })).toBeVisible();
  await page.getByRole("combobox", { name: "Year" }).selectOption({ label: "1995" });
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
  await expect(page.locator(".mg", { has: day }).locator(".sec-h2 span:visible")).toHaveText("1 transcript");
  await page.reload();
  await expect(day).toBeVisible();
});

test("a remembered choice to show legislative days applies before the first paint, counts included", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("otr:show-ld", "1"); } catch { /* storage blocked */ } });
  // Hold the page's scripts back, as a slow connection would; watch from the first bytes.
  await page.route("**/_astro/*.js", async (route) => { await new Promise((done) => setTimeout(done, 3000)); await route.continue(); });
  await page.goto("browse/2023/", { waitUntil: "commit" });
  const day = page.locator(".tr li.ld").first();
  await expect(day).toBeVisible({ timeout: 2500 });
  const month = page.locator(".mg", { has: day });
  await expect(month.locator(".sec-h2 .c-on")).toBeVisible();
  await expect(month.locator(".sec-h2 .c-off")).toBeHidden();
});

test("years are one dropdown with previous and next beside it, not a row of chips", async ({ page }) => {
  await page.goto("browse/2023/");
  await expect(page.locator(".yrs")).toHaveCount(0);
  const pick = page.getByRole("combobox", { name: "Year" });
  await expect(pick).toHaveValue(/\/browse\/2023\/$/);
  await page.getByRole("link", { name: /^Previous year/ }).click();
  await expect(page).toHaveURL(/browse\/2021\/$/);
  await page.getByRole("link", { name: /^Next year/ }).click();
  await expect(page).toHaveURL(/browse\/2023\/$/);
  await page.getByRole("combobox", { name: "Year" }).selectOption({ label: "1995" });
  await expect(page).toHaveURL(/browse\/1995\/$/);
  await expect(page.getByRole("link", { name: /^Previous year/ })).toHaveCount(0); // nothing older
});

